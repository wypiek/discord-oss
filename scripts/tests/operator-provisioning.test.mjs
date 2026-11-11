import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { setOperator } from "../ops/operator.mjs";

test("operator provisioning rejects invalid arguments before accessing the database", async () => {
    const client = { query: () => assert.fail("Database must not be accessed") };
    for (const [action, id] of [
        ["grant", "1 OR 1=1"],
        ["grant", "0"],
        ["delete", "123"],
        ["grant", "123456789012345678901"],
    ])
        await assert.rejects(setOperator(client, action, id), /Usage/);
});

test("operator grant and revoke preserve other rights and reject inactive or bot accounts", { skip: !process.env.DATABASE_TEST_ADMIN_URL }, async () => {
    const admin = new Client({ connectionString: process.env.DATABASE_TEST_ADMIN_URL });
    const name = `meowcord_operator_${randomUUID().replaceAll("-", "")}`;
    let client,
        created = false;
    await admin.connect();
    try {
        await admin.query(`CREATE DATABASE "${name}"`);
        created = true;
        const url = new URL(process.env.DATABASE_TEST_ADMIN_URL);
        url.pathname = `/${name}`;
        client = new Client({ connectionString: url.toString() });
        await client.connect();
        await client.query(
            "CREATE TABLE users (id text PRIMARY KEY, rights text NOT NULL, bot boolean NOT NULL DEFAULT false, disabled boolean NOT NULL DEFAULT false, deleted boolean NOT NULL DEFAULT false)",
        );
        await client.query("INSERT INTO users (id, rights) VALUES ('123', '9007199254740992')");
        assert.equal(await setOperator(client, "grant", "123"), true);
        assert.equal(await setOperator(client, "grant", "123"), false);
        assert.equal((await client.query("SELECT rights FROM users WHERE id = '123'")).rows[0].rights, "9007199254740993");
        assert.equal(await setOperator(client, "revoke", "123"), true);
        assert.equal((await client.query("SELECT rights FROM users WHERE id = '123'")).rows[0].rights, "9007199254740992");
        for (const field of ["bot", "disabled", "deleted"]) {
            await client.query(`UPDATE users SET ${field} = true WHERE id = '123'`);
            await assert.rejects(setOperator(client, "grant", "123"), /active human/);
            await client.query(`UPDATE users SET ${field} = false WHERE id = '123'`);
        }
        await assert.rejects(setOperator(client, "grant", "456"), /does not exist/);
        assert.equal((await client.query("SELECT rights FROM users WHERE id = '123'")).rows[0].rights, "9007199254740992");
    } finally {
        await client?.end();
        if (created) await admin.query(`DROP DATABASE "${name}"`);
        await admin.end();
    }
});
