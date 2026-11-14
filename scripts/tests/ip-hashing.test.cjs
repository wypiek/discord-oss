const { test, mock } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Database } = require("bun:sqlite");
const ipHash = require("./helpers/ip-hash.cjs");
const { backfillIpHashes } = require("../../dist/database/IpHashBackfill");

const { hashIp, hashIpGroup, hashIpKey, ipFingerprint, ipLabel, isIpHash, resetIpHashSecret, ipHashSecretFile } = ipHash;

function withSecretEnvironment(environment, run) {
    const saved = { IP_HASH_SECRET: process.env.IP_HASH_SECRET, IP_HASH_SECRET_FILE: process.env.IP_HASH_SECRET_FILE, CONFIG_PATH: process.env.CONFIG_PATH };
    for (const key of Object.keys(saved)) delete process.env[key];
    Object.assign(process.env, environment);
    resetIpHashSecret();
    try {
        return run();
    } finally {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        resetIpHashSecret();
    }
}

test("a stored address is a keyed, prefixed, fixed length hash that never contains the address", () => {
    const hash = hashIp("203.0.113.7");
    assert.match(hash, /^iph1_[A-Za-z0-9_-]{43}$/);
    assert.equal(isIpHash(hash), true);
    assert.equal(hash.includes("203.0.113.7"), false);
    assert.equal(hashIp("203.0.113.7"), hash, "the same address always gives the same hash");
    assert.notEqual(hashIp("203.0.113.8"), hash);
    const other = withSecretEnvironment({ IP_HASH_SECRET: "another-secret-another-secret-another-1" }, () => hashIp("203.0.113.7"));
    assert.notEqual(other, hash, "a different secret gives a different hash");
});

test("addresses are normalized before hashing, and anything that isn't an address hashes to nothing", () => {
    assert.equal(hashIp("::ffff:203.0.113.7"), hashIp("203.0.113.7"));
    assert.equal(hashIp("::FFFF:203.0.113.7"), hashIp("203.0.113.7"));
    assert.equal(hashIp(" 203.0.113.7 "), hashIp("203.0.113.7"));
    assert.equal(hashIp("2001:DB8::1"), hashIp("2001:db8::1"));
    for (const value of [undefined, null, "", "203.0.113", "not an address", "203.0.113.7/24", 42, ["203.0.113.7"]]) assert.equal(hashIp(value), null, String(value));
    const hash = hashIp("198.51.100.4");
    assert.equal(hashIp(hash), hash, "a hash passes through unchanged");
    assert.equal(hashIp("iph1_tooshort"), null);
});

test("networks hash by group: IPv4 on its own and IPv6 per /64", () => {
    assert.equal(hashIpGroup("203.0.113.7"), hashIp("203.0.113.7"));
    assert.equal(hashIpGroup("::ffff:203.0.113.7"), hashIp("203.0.113.7"));
    assert.equal(hashIpGroup("2001:db8:1:2::5"), hashIpGroup("2001:db8:1:2:aaaa:bbbb:cccc:dddd"));
    assert.equal(hashIpGroup("2001:db8:1:2::5"), hashIpKey("2001:db8:1:2::/64"));
    assert.notEqual(hashIpGroup("2001:db8:1:2::5"), hashIpGroup("2001:db8:1:3::5"));
    assert.notEqual(hashIpGroup("2001:db8:1:2::5"), hashIp("2001:db8:1:2::5"));
    assert.equal(hashIpGroup("nope"), null);
});

test("fingerprints are the first 10 characters after the prefix, and log labels never show an address", () => {
    const hash = hashIp("203.0.113.7");
    assert.equal(ipFingerprint(hash), hash.slice(5, 15));
    assert.equal(ipFingerprint("203.0.113.7"), null);
    assert.equal(ipFingerprint(null), null);
    assert.equal(ipLabel("203.0.113.7"), hash.slice(5, 15));
    assert.equal(ipLabel(hash), hash.slice(5, 15));
    assert.equal(ipLabel(undefined), "unknown address");
});

test("without IP_HASH_SECRET the secret is generated once into a private file next to the config and reused", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ip-hash-"));
    const warnings = [];
    const warn = mock.method(console, "warn", (...args) => warnings.push(args.join(" ")));
    try {
        const first = withSecretEnvironment({ CONFIG_PATH: path.join(directory, "config.json") }, () => {
            assert.equal(ipHashSecretFile(), path.join(directory, ".ip-hash.key"));
            return hashIp("203.0.113.7");
        });
        const file = path.join(directory, ".ip-hash.key");
        assert.equal(fs.statSync(file).mode & 0o777, 0o600);
        const secret = fs.readFileSync(file, "utf8").trim();
        assert.ok(secret.length >= 32);
        assert.equal(warnings.length, 1);
        assert.match(warnings[0], /Back it up/);
        assert.equal(warnings[0].includes(secret), false, "the warning never prints the secret");
        const second = withSecretEnvironment({ CONFIG_PATH: path.join(directory, "config.json") }, () => hashIp("203.0.113.7"));
        assert.equal(second, first, "a restart reuses the stored secret");
        assert.equal(warnings.length, 1, "the warning only appears when the secret is created");
        const fromEnvironment = withSecretEnvironment({ IP_HASH_SECRET: secret }, () => hashIp("203.0.113.7"));
        assert.equal(fromEnvironment, first, "the file's content works as IP_HASH_SECRET");
        const custom = path.join(directory, "custom.key");
        withSecretEnvironment({ IP_HASH_SECRET_FILE: custom }, () => hashIp("203.0.113.7"));
        assert.ok(fs.existsSync(custom));
        assert.deepEqual(fs.readdirSync(directory).sort(), [".ip-hash.key", "custom.key"], "no temporary files stay behind");
    } finally {
        warn.mock.restore();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test("a short IP_HASH_SECRET is refused instead of weakening every hash", () => {
    withSecretEnvironment({ IP_HASH_SECRET: "short" }, () => assert.throws(() => hashIp("203.0.113.7"), /at least 32 characters/));
});

function legacyDatabase() {
    const db = new Database(":memory:");
    db.run(`CREATE TABLE users ("id" text PRIMARY KEY, "registration_ip" varchar, "registration_ip_group" varchar)`);
    db.run(`CREATE TABLE sessions ("session_id" text PRIMARY KEY, "user_id" text, "last_seen_ip" varchar, "last_seen_ip_group" varchar)`);
    db.run(`CREATE TABLE bans ("id" text PRIMARY KEY, "ip" varchar)`);
    db.run(`CREATE TABLE instance_bans ("id" text PRIMARY KEY, "ip_address" varchar, "reason" varchar)`);
    db.run(`CREATE TABLE automod_actions ("id" text PRIMARY KEY, "rule" varchar, "term" varchar)`);
    db.run(`CREATE TABLE rate_limits ("id" text PRIMARY KEY, "executor_id" varchar)`);
    db.run(`CREATE TABLE audit_logs ("id" int8 PRIMARY KEY, "action_type" integer NOT NULL, "changes" text NOT NULL)`);
    const insert = (table, rows) => {
        for (const row of rows) {
            const columns = Object.keys(row);
            db.query(`INSERT INTO ${table} (${columns.map((column) => `"${column}"`).join(", ")}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(", ")})`).all(
                ...Object.values(row),
            );
        }
    };
    insert("users", [
        { id: "1", registration_ip: "203.0.113.7" },
        { id: "2", registration_ip: "::ffff:203.0.113.7" },
        { id: "3", registration_ip: "2001:db8:1:2::5" },
        { id: "4", registration_ip: null },
        { id: "5", registration_ip: "garbage" },
    ]);
    for (let index = 0; index < 1203; index++) insert("sessions", [{ session_id: `S${index}`, user_id: "1", last_seen_ip: `198.51.${Math.floor(index / 250)}.${index % 250}` }]);
    insert("sessions", [{ session_id: "V6", user_id: "3", last_seen_ip: "2001:db8:1:2:aaaa::1" }]);
    insert("bans", [
        { id: "1", ip: "203.0.113.9" },
        { id: "2", ip: null },
    ]);
    insert("instance_bans", [
        { id: "10", ip_address: "203.0.113.7", reason: "Raid" },
        { id: "11", ip_address: "::ffff:198.51.100.4", reason: "Spam" },
        { id: "20", ip_address: null, reason: "Used the banned address 203.0.113.7, ban 10" },
        { id: "30", ip_address: null, reason: "Account ban" },
    ]);
    insert("automod_actions", [
        { id: "1", rule: "ip_account_limit", term: "3 accounts on 203.0.113.7, limit 2" },
        { id: "2", rule: "ip_account_limit", term: "1 account on 2001:db8:1:2::/64, limit 1" },
        { id: "3", rule: "slur", term: "something on something, limit 3" },
    ]);
    insert("rate_limits", [
        { id: "203.0.113.7:ip:ip", executor_id: "203.0.113.7" },
        { id: "2001:db8:1:2::/64:route1:POST auth/register", executor_id: "2001:db8:1:2::/64" },
        { id: "automod-register:203.0.113.7", executor_id: "203.0.113.7" },
        { id: "automod-login:1:203.0.113.7", executor_id: "1" },
        { id: "automod-login:1:2001:db8:0:0::/64", executor_id: "1" },
        { id: "automod-login:1", executor_id: "1" },
        { id: "help-vote:203.0.113.7", executor_id: "203.0.113.7" },
        { id: "cap-request:challenge:0123abcd", executor_id: "cap" },
        { id: "cap-nonce:abcdef", executor_id: "cap" },
        { id: "1:guild-create:guild-create", executor_id: "1" },
        { id: `${hashIpKey("203.0.113.0")}:ip:ip`, executor_id: hashIpKey("203.0.113.0") },
    ]);
    insert("audit_logs", [
        {
            id: 1,
            action_type: 2002,
            changes: JSON.stringify([
                { key: "ip", new_value: "203.0.113.7" },
                { key: "reason", new_value: "Raid" },
            ]),
        },
        { id: 2, action_type: 2002, changes: JSON.stringify([{ key: "ipAllowList", new_value: ["198.51.100.4", "10.0.0.0/8"] }]) },
        { id: 3, action_type: 2002, changes: JSON.stringify([{ key: "reason", new_value: "nothing to hide" }]) },
        { id: 4, action_type: 22, changes: JSON.stringify([{ key: "name", new_value: "server 1.2.3.4" }]) },
    ]);
    return { db, executor: { query: async (sql, params = []) => db.query(sql).all(...params) } };
}

const RAW_ADDRESS = /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?!\/)|2001:db8/;

test("the backfill replaces every stored address with its hash in batches, and running it again changes nothing", async () => {
    const { db, executor } = legacyDatabase();
    const first = await backfillIpHashes(executor);
    assert.deepEqual(first, { users: 4, sessions: 1204, bans: 1, instance_bans: 2, ban_reasons: 1, automod_terms: 2, rate_limits: 7, audit_logs: 2 });

    const user = (id) => db.query(`SELECT * FROM users WHERE id = $1`).get(id);
    assert.equal(user("1").registration_ip, hashIp("203.0.113.7"));
    assert.equal(user("2").registration_ip, hashIp("203.0.113.7"), "both IPv4 spellings end up as one hash");
    assert.equal(user("1").registration_ip_group, hashIpGroup("203.0.113.7"));
    assert.equal(user("3").registration_ip_group, hashIpGroup("2001:db8:1:2::77"));
    assert.equal(user("4").registration_ip, null);
    assert.equal(user("5").registration_ip, null, "a value that isn't an address is dropped");
    const v6 = db.query(`SELECT * FROM sessions WHERE session_id = 'V6'`).get();
    assert.equal(v6.last_seen_ip, hashIp("2001:db8:1:2:aaaa::1"));
    assert.equal(v6.last_seen_ip_group, user("3").registration_ip_group, "the same /64 matches across tables");
    assert.equal(db.query(`SELECT ip FROM bans WHERE id = '1'`).get().ip, hashIp("203.0.113.9"));
    assert.equal(db.query(`SELECT ip_address FROM instance_bans WHERE id = '11'`).get().ip_address, hashIp("198.51.100.4"));
    const fingerprint = ipFingerprint(hashIp("203.0.113.7"));
    assert.equal(db.query(`SELECT reason FROM instance_bans WHERE id = '20'`).get().reason, `Used a banned address with fingerprint ${fingerprint}, ban 10`);
    assert.equal(db.query(`SELECT term FROM automod_actions WHERE id = '1'`).get().term, `3 accounts from the network with fingerprint ${fingerprint}, limit 2`);
    assert.equal(
        db.query(`SELECT term FROM automod_actions WHERE id = '2'`).get().term,
        `1 account from the network with fingerprint ${ipFingerprint(hashIpGroup("2001:db8:1:2::1"))}, limit 1`,
    );
    assert.equal(db.query(`SELECT term FROM automod_actions WHERE id = '3'`).get().term, "something on something, limit 3");
    assert.deepEqual(
        db
            .query(`SELECT id FROM rate_limits ORDER BY id`)
            .all()
            .map((row) => row.id),
        ["1:guild-create:guild-create", "automod-login:1", "cap-nonce:abcdef", `${hashIpKey("203.0.113.0")}:ip:ip`].sort(),
    );

    const changes = (id) => JSON.parse(db.query(`SELECT changes FROM audit_logs WHERE id = $1`).get(id).changes);
    assert.deepEqual(changes(1), [
        { key: "ip", new_value: `address ${fingerprint}` },
        { key: "reason", new_value: "Raid" },
    ]);
    assert.deepEqual(changes(2), [{ key: "ipAllowList", new_value: [`address ${ipFingerprint(hashIp("198.51.100.4"))}`, "10.0.0.0/8"] }]);
    assert.deepEqual(changes(4), [{ key: "name", new_value: "server 1.2.3.4" }], "guild audit logs are left alone");
    db.run(`DELETE FROM audit_logs WHERE id = 4`);

    const dump = () =>
        JSON.stringify(
            ["users", "sessions", "bans", "instance_bans", "automod_actions", "rate_limits", "audit_logs"].map((table) => db.query(`SELECT * FROM ${table} ORDER BY 1`).all()),
        );
    assert.doesNotMatch(dump(), RAW_ADDRESS);
    const before = dump();
    const second = await backfillIpHashes(executor);
    assert.deepEqual(second, { users: 0, sessions: 0, bans: 0, instance_bans: 0, ban_reasons: 0, automod_terms: 0, rate_limits: 0, audit_logs: 0 });
    assert.equal(dump(), before);
});

test("instance bans match by hashing the live address and never by the stored text", async () => {
    const { InstanceBan } = require("../../dist/database/entities/InstanceBan");
    const lookups = [];
    const stored = { id: "1", ip_address: hashIp("93.184.216.34"), is_allowlisted: false, is_from_other_instance_ban: false, created_at: new Date() };
    const find = mock.method(InstanceBan, "find", async ({ where }) => {
        lookups.push(where);
        return where.some((clause) => clause.ip_address === stored.ip_address) ? [stored] : [];
    });
    try {
        assert.equal(await InstanceBan.hasInstanceBans({ ipAddress: "::ffff:93.184.216.34" }), true);
        assert.deepEqual(lookups.at(-1), [{ ip_address: hashIp("93.184.216.34") }]);
        assert.equal(await InstanceBan.hasInstanceBans({ ipAddress: "93.184.216.35" }), false);
        assert.deepEqual(await InstanceBan.findInstanceBans({ ipAddress: "93.184.216.34" }), ["ipAddress"]);
        lookups.length = 0;
        assert.equal(await InstanceBan.hasInstanceBans({ ipAddress: "127.0.0.1" }), false, "a shared address is never looked up");
        assert.equal(lookups.length, 0);
        assert.doesNotMatch(JSON.stringify(lookups), RAW_ADDRESS);
        assert.equal(InstanceBan.spreadReason(stored), `Used a banned address with fingerprint ${ipFingerprint(stored.ip_address)}, ban 1`);
    } finally {
        find.mock.restore();
    }
});
