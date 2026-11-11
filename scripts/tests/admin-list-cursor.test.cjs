const assert = require("node:assert/strict");
const fs = require("node:fs");
const { test } = require("node:test");
const { decodeCursor, encodeCursor, keysetClause, listOffset, MAX_LIST_OFFSET } = require("../../dist/api/util/utility/adminCursor");

const code = (error) => error.status ?? error.code;

test("list cursors round trip and refuse anything a page didn't hand out", () => {
    const cursor = encodeCursor(["2026-10-18T21:08:29.838Z", "1561486134922481730"]);
    assert.match(cursor, /^[A-Za-z0-9_-]+$/);
    assert.deepEqual(decodeCursor(cursor, 2), ["2026-10-18T21:08:29.838Z", "1561486134922481730"]);
    assert.equal(decodeCursor(undefined, 2), undefined);
    assert.equal(decodeCursor("", 2), undefined);
    for (const bad of [cursor.slice(0, -3), "not a cursor", encodeCursor(["only one"]), Buffer.from('[{"a":1},"2"]').toString("base64url"), "x".repeat(513), [cursor, cursor]])
        assert.throws(
            () => decodeCursor(bad, 2),
            (error) => code(error) === 400,
        );
});

test("keyset clauses continue after the last row in the list's own order", () => {
    assert.deepEqual(keysetClause([["guild.id", "DESC"]], ["9"]), { sql: "guild.id < :keyset0", params: { keyset0: "9" } });
    assert.deepEqual(
        keysetClause(
            [
                ["user.username", "ASC"],
                ["user.id", "ASC"],
            ],
            ["cat", "5"],
        ),
        {
            sql: "(user.username > :keyset0 OR (user.username = :keyset0 AND user.id > :keyset1))",
            params: { keyset0: "cat", keyset1: "5" },
        },
    );
});

test("list offsets stop at 10,000 so deep pages go through cursors", () => {
    assert.equal(listOffset(undefined), 0);
    assert.equal(listOffset(String(MAX_LIST_OFFSET)), MAX_LIST_OFFSET);
    for (const bad of [String(MAX_LIST_OFFSET + 1), "-1", "1.5", "NaN", ["1", "2"]])
        assert.throws(
            () => listOffset(bad),
            (error) => code(error) === 400,
        );
});

test("the users and servers pages page with the cursor each response returns", () => {
    const admin = fs.readFileSync("assets/public/admin/admin.js", "utf8");
    assert.match(admin, /const remember = pageQuery\(usersState, params\);/);
    assert.match(admin, /const remember = pageQuery\(guildsState, params\);/);
    for (const file of ["src/api/routes/admin/users/index.ts", "src/api/routes/admin/guilds/index.ts"]) {
        const source = fs.readFileSync(file, "utf8");
        assert.match(source, /decodeCursor\(req\.query\.after/, file);
        assert.match(source, /next,/, file);
    }
    for (const file of ["reports/index.ts", "instance-invites/index.ts", "ips/index.ts", "ips/bans/index.ts"])
        assert.match(fs.readFileSync(`src/api/routes/admin/${file}`, "utf8"), /listOffset\(req\.query\.offset\)/, file);
});
