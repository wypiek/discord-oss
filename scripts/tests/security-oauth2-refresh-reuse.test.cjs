const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { StubError, loadModule, response } = require("./helpers/route-harness.cjs");

const hash = (value) => crypto.createHash("sha256").update(value).digest("base64url");
const matches = (row, where) => Object.entries(where).every(([key, value]) => row[key] === value);

function oauth2Module(rows) {
    const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "secp521r1" });
    let ids = 0;
    return loadModule("src/api/util/utility/oauth2.ts", {
        typeorm: { IsNull: () => null, LessThan: (value) => value },
        "@spacebar/database": {
            Application: {},
            ApplicationAuthorization: {},
            User: {},
            OAuth2Token: {
                delete: async () => undefined,
                create: (row) => ({ save: async () => rows.push({ ...row }) }),
            },
        },
        "@spacebar/util": {
            emitEvent: async () => undefined,
            hashOAuth2Token: hash,
            JwtKeypairManager: { keypair: { privateKey } },
            Snowflake: { generate: () => String(1000 + ++ids) },
        },
        "./mfa": {
            ResponseError: class extends Error {
                constructor(status, body) {
                    super(body.error);
                    this.status = status;
                    this.body = body;
                }
            },
        },
    });
}

function tokenRoute() {
    const rows = [];
    const oauth2 = oauth2Module(rows);
    let handler;
    loadModule("src/api/routes/oauth2/token/index.ts", {
        express: {
            Router: () => ({
                post: (_, ...steps) => {
                    handler = steps.at(-1);
                },
            }),
            urlencoded: () => () => undefined,
        },
        "@spacebar/api/middlewares": { route: () => () => undefined },
        "@spacebar/api/util": {
            ...oauth2,
            authenticateClient: async () => ({ id: "app", owner_id: "owner" }),
            readTicket: (code) => (code === "the-code" ? { typ: "oauth2_code", uid: "user", app: "app", scopes: ["identify"] } : null),
        },
        "@spacebar/database": {
            ApplicationAuthorization: { findOne: async () => ({ id: "authorization" }) },
            Guild: { findOne: async () => null },
            OAuth2Token: {
                findOne: async ({ where }) => rows.find((row) => matches(row, where)) ?? null,
                delete: async (where) => {
                    for (let index = rows.length - 1; index >= 0; index--) if (matches(rows[index], where)) rows.splice(index, 1);
                },
                update: async (where, values) => {
                    const row = rows.find((candidate) => matches(candidate, where));
                    if (row) Object.assign(row, values);
                    return { affected: row ? 1 : 0 };
                },
            },
        },
        "@spacebar/util": { hashOAuth2Token: hash },
    });
    const post = async (body) => {
        const res = response();
        res.setHeader = () => undefined;
        await handler({ body }, res);
        return res.body;
    };
    return { post, rows, oauth2 };
}

test("reusing a rotated refresh token revokes the whole token family", async () => {
    const { post, rows } = tokenRoute();
    const first = await post({ grant_type: "authorization_code", code: "the-code" });
    assert.equal(rows.length, 1);
    const second = await post({ grant_type: "refresh_token", refresh_token: first.refresh_token });
    assert.notEqual(second.refresh_token, first.refresh_token);
    assert.equal(rows[0].access_token_hash, hash(second.access_token));

    await assert.rejects(post({ grant_type: "refresh_token", refresh_token: first.refresh_token }), /invalid_grant/);
    assert.equal(rows.length, 0);
    await assert.rejects(post({ grant_type: "refresh_token", refresh_token: second.refresh_token }), /invalid_grant/);
});

test("a forged refresh token naming a family doesn't revoke it", async () => {
    const { post, rows } = tokenRoute();
    const first = await post({ grant_type: "authorization_code", code: "the-code" });
    const [family] = first.refresh_token.split(".");
    await assert.rejects(post({ grant_type: "refresh_token", refresh_token: `${family}.forged.forged` }), /invalid_grant/);
    await assert.rejects(post({ grant_type: "refresh_token", refresh_token: "unknown-opaque-token" }), /invalid_grant/);
    assert.equal(rows.length, 1);
    const next = await post({ grant_type: "refresh_token", refresh_token: first.refresh_token });
    assert.ok(next.access_token);
});

test("client credentials refuse unknown scopes with Discord's invalid_scope error", async () => {
    const { post } = tokenRoute();
    await assert.rejects(post({ grant_type: "client_credentials", scope: "identify made.up" }), (error) => {
        assert.equal(error.status, 400);
        assert.equal(JSON.stringify(error.body), JSON.stringify({ error: "invalid_scope", error_description: "The requested scope is invalid, unknown, or malformed." }));
        return true;
    });
});

test("authorization refuses unknown scope names instead of storing them", () => {
    const { parseOAuth2Scopes } = oauth2Module([]);
    assert.equal(JSON.stringify(parseOAuth2Scopes("identify guilds identify")), JSON.stringify(["identify", "guilds"]));
    assert.equal(JSON.stringify(parseOAuth2Scopes("", ["bot"])), JSON.stringify(["bot"]));
    assert.throws(
        () => parseOAuth2Scopes("identify made.up"),
        (error) => error.body?.error === "invalid_scope",
    );
    const authorize = require("node:fs").readFileSync("src/api/routes/oauth2/authorize.ts", "utf8");
    assert.equal((authorize.match(/parseOAuth2Scopes\(req\.query\.scope/g) ?? []).length, 2);
});
