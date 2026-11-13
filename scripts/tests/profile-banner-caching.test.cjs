const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { HTTPError } = require("../../dist/util/util/lambert-server/HTTPError");
const { setCacheControl, setCacheControlNotFound } = require("../../dist/cdn/util/middlewares");
const { ErrorHandler } = require("../../dist/cdn/util/ErrorHandler");

function response() {
    const headers = {};
    const res = {
        statusCode: 200,
        body: undefined,
        headers,
        setHeader: (name, value) => (headers[name.toLowerCase()] = value),
        getHeader: (name) => headers[name.toLowerCase()],
        status(code) {
            res.statusCode = code;
            return res;
        },
        send(body) {
            res.body = body;
            return res;
        },
        json(body) {
            res.body = body;
            return res;
        },
    };
    return res;
}

test("a banner that exists is cached for its hash", () => {
    const res = response();
    setCacheControl({}, res, () => undefined);
    assert.match(res.headers["cache-control"], /max-age=21600/);
});

test("a missing banner is never cached", () => {
    const res = response();
    setCacheControl({}, res, () => undefined);
    setCacheControlNotFound({ path: "/banners/1/a_missing.gif" }, res);
    assert.equal(res.statusCode, 404);
    assert.equal(res.headers["cache-control"], "no-store");
});

test("a cdn error drops the cache header a route set before it failed", () => {
    const res = response();
    setCacheControl({}, res, () => undefined);
    ErrorHandler(new HTTPError("not found", 404), { method: "GET", url: "/guilds/1/users/2/banners/missing.png", t: (key) => key }, res, () => undefined);
    assert.equal(res.statusCode, 404);
    assert.equal(res.headers["cache-control"], "no-store");
});

test("profile and user lookups are never served from a cache", () => {
    for (const file of ["src/api/routes/users/#user_id/profile.ts", "src/api/routes/users/#user_id/index.ts"]) {
        const source = fs.readFileSync(file, "utf8");
        assert.match(source, /res\.set\("Cache-Control", "private, no-store"\)\.json\(/, file);
    }
});
