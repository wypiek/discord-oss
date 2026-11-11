const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const { DataSource } = require("typeorm");
const { execFileSync } = require("node:child_process");

function load(file) {
    const exports = {};
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    vm.runInNewContext(code, { exports, require, Date });
    return exports;
}

test("MFA ticket reservations survive connections, cap concurrent attempts and consume success once through TypeORM", {
    skip: process.env.MFA_ATTEMPT_PG_TEST !== "1",
}, async () => {
    const name = `mfa_attempt_test_${process.pid}`;
    execFileSync("createdb", [name]);
    const clients = Array.from(
        { length: 10 },
        () => new DataSource({ type: "postgres", host: process.env.PGHOST || "/tmp", database: name, username: process.env.PGUSER || process.env.USER, entities: [] }),
    );
    try {
        await Promise.all(clients.map((client) => client.initialize()));
        const store = (client) => client;
        const migration = load("src/database/migration/postgres/1791809006006-MfaTicketAttempts.ts");
        await new migration.MfaTicketAttempts1791809006006().up(store(clients[0]));
        await new migration.MfaTicketAttempts1791809006006().up(store(clients[0]));
        const { reserveMfaAttempt, consumeMfaTicket } = load("src/api/util/utility/mfaAttempt.ts");
        const expires = Date.now() + 300000;
        const attempts = await Promise.all(clients.map((client) => reserveMfaAttempt(store(client), "ticket", expires)));
        assert.equal(attempts.filter(Boolean).length, 5);
        const reconnect = new DataSource({ type: "postgres", host: process.env.PGHOST || "/tmp", database: name, username: process.env.PGUSER || process.env.USER, entities: [] });
        await reconnect.initialize();
        try {
            assert.equal(await reserveMfaAttempt(store(reconnect), "ticket", expires), null);
            const successes = await Promise.all(clients.map((client) => consumeMfaTicket(store(client), attempts.find(Boolean))));
            assert.equal(successes.filter(Boolean).length, 1);
            const hash = await reserveMfaAttempt(store(reconnect), "success-ticket", expires);
            assert.equal(await consumeMfaTicket(store(reconnect), hash), true);
            assert.equal(await reserveMfaAttempt(store(reconnect), "success-ticket", expires), null);
            const row = await reconnect.query('SELECT "ticket_hash", "attempts" FROM "mfa_ticket_attempts" WHERE "ticket_hash" = $1', [attempts.find(Boolean)]);
            assert.equal(row[0].attempts, 5);
            assert.equal(row[0].ticket_hash.length, 64);
            await reconnect.query(`INSERT INTO "mfa_ticket_attempts" SELECT lpad(i::text, 64, '0'), 1, false, now() - interval '1 minute' FROM generate_series(1, 150) i`);
            await reserveMfaAttempt(store(reconnect), "cleanup-ticket", expires);
            const expired = await reconnect.query('SELECT count(*)::integer AS count FROM "mfa_ticket_attempts" WHERE "expires_at" < now()');
            assert.equal(expired[0].count, 50);
        } finally {
            await reconnect.destroy();
        }
    } finally {
        await Promise.all(clients.map((client) => (client.isInitialized ? client.destroy() : Promise.resolve())));
        execFileSync("dropdb", [name]);
    }
});
