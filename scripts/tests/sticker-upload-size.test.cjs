const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const multer = require("multer");
const { loadModule } = require("./helpers/route-harness.cjs");

class HTTPError extends Error {
    constructor(message, code = 400) {
        super(message);
        this.code = code;
    }
}

test("guild sticker uploads over 512 KiB are refused before the route runs", async (t) => {
    const router = loadModule("src/api/routes/guilds/#guild_id/stickers.ts", {
        express,
        multer,
        "lambert-server/HTTPError": { HTTPError },
        "@spacebar/api/middlewares": { route: () => (_req, _res, next) => next() },
        "@spacebar/database": {
            AuditLog: {},
            Member: {},
            Sticker: {
                count: async () => {
                    throw new HTTPError("handler reached", 418);
                },
            },
        },
        "@spacebar/util": {
            GuildStickersUpdateEvent: {},
            Snowflake: { generate: () => "1" },
            emitEvent: async () => {},
            uploadFile: async () => {},
            deleteFile: async () => {},
            Config: {},
            DiscordApiErrors: {},
        },
        "@spacebar/schemas": { AuditLogEvents: {}, ModifyGuildStickerSchema: {}, StickerFormatType: {}, StickerType: {} },
    }).default;
    const app = express();
    app.use("/guilds/:guild_id/stickers", (req, res, next) => Promise.resolve(router(req, res, next)).catch(next));
    app.use((error, _req, res, _next) => res.status(error.code || 500).json({ message: error.message }));
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    t.after(() => server.close());
    const upload = async (bytes) => {
        const form = new FormData();
        form.append("name", "cat");
        form.append("tags", "cat");
        form.append("file", new Blob([new Uint8Array(bytes)], { type: "image/png" }), "cat.png");
        const response = await fetch(`http://127.0.0.1:${server.address().port}/guilds/1/stickers`, { method: "POST", body: form });
        return { status: response.status, body: await response.json() };
    };
    const large = await upload(512 * 1024 + 1);
    assert.equal(large.status, 413);
    assert.match(large.body.message, /512 KiB/);
    assert.equal((await upload(512 * 1024)).status, 418);
});
