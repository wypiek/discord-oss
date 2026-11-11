const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");

test("the cdn mounts its error handler after every route", () => {
    const source = fs.readFileSync("src/cdn/Server.ts", "utf8");
    const handler = source.indexOf("this.app.use(ErrorHandler)");
    assert.ok(handler > 0);
    assert.equal(source.indexOf("this.app.use(ErrorHandler)", handler + 1), -1);
    for (const route of ["registerRoutes(this", '"/guilds/:guild_id/users/:user_id/avatars", guildProfilesRoute', '"/guilds/:guild_id/users/:user_id/banners", guildProfilesRoute'])
        assert.ok(source.indexOf(route) < handler, `${route} is mounted after the error handler`);
});

test("the bundle ends with a json error handler after the client routes", () => {
    const source = fs.readFileSync("src/bundle/Server.ts", "utf8");
    const client = source.indexOf("TestClient(app);");
    const handler = source.indexOf("app.use((error:");
    assert.ok(client > 0 && handler > client);
    assert.match(source.slice(handler, handler + 600), /malformed escape sequence/);
    assert.doesNotMatch(source.slice(handler, handler + 600), /error\.stack/);
});
