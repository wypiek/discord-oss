const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { StubError, loadModule, response } = require("./helpers/route-harness.cjs");

function tokenRoute() {
    const rows = [];
    let issued = 0;
    const hash = (value) => crypto.createHash("sha256").update(value).digest("base64url");
    const matches = (row, where) => Object.entries(where).every(([key, value]) => row[key] === value);
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
            authenticateClient: async () => ({ id: "app" }),
            CLIENT_CREDENTIALS_SCOPES: [],
            isPublicClient: () => false,
            issueOAuth2Token: async ({ code_hash }) => {
                if (rows.some((row) => row.code_hash === code_hash)) throw Object.assign(new Error("duplicate"), { code: "23505" });
                issued++;
                const access_token = `access-${issued}`;
                rows.push({
                    id: `row-${issued}`,
                    code_hash,
                    access_token_hash: hash(access_token),
                    refresh_token_hash: hash(`refresh-${issued}`),
                    expires_at: new Date(Date.now() + 604800000),
                });
                return { access_token };
            },
            OAuth2Error: (error) => new StubError(error),
            OAUTH2_CODE_TTL: 600,
            OAUTH2_TOKEN_TTL: 604800,
            oauth2TokenResponse: () => ({}),
            pkceChallenge: () => "",
            randomOAuth2Token: () => crypto.randomBytes(32).toString("base64url"),
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
    const redeem = async () => {
        const res = response();
        res.setHeader = () => undefined;
        await handler({ body: { grant_type: "authorization_code", code: "the-code" } }, res);
        return res.body;
    };
    return { redeem, rows, hash };
}

test("an authorization code stays spent after its reuse is detected", async () => {
    const { redeem, rows, hash } = tokenRoute();
    const first = await redeem();
    assert.equal(first.access_token, "access-1");
    await assert.rejects(redeem(), /invalid_grant/);
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0].access_token_hash, hash("access-1"));
    assert.equal(rows[0].refresh_token_hash, null);
    assert.ok(rows[0].expires_at.getTime() <= Date.now() + 600_000);
    await assert.rejects(redeem(), /invalid_grant/);
    await assert.rejects(redeem(), /invalid_grant/);
    assert.equal(rows.length, 1);
});
