import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { solveCap } from "./cap-token.mjs";
import { chromiumPath } from "../util/chromium.cjs";

const environment = Object.fromEntries(
    readFileSync(".env", "utf8")
        .split("\n")
        .filter((line) => line.includes("="))
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);
const database = environment.DATABASE;
const expected = process.env.COMPONENTS_TEST_DATABASE_NAME;
assert.ok(expected, "Set COMPONENTS_TEST_DATABASE_NAME to the database created for this test run");
assert.equal(decodeURIComponent(new URL(database).pathname.slice(1)), expected, "Components proof requires its selected isolated database");
assert.equal(
    execFileSync("psql", [database, "-At", "-c", "select current_database()"], {
        encoding: "utf8",
    }).trim(),
    expected,
);
const port = process.env.PORT || "3397";
const origin = `http://localhost:${port}`;
const api = `${origin}/api/v9`;
const require = createRequire(import.meta.url);
const WebSocket = require("ws");
const { chromium } = createRequire(`${homedir()}/.cache/fosscord-tools/`)("playwright-core");
const suffix = randomBytes(5).toString("hex");
const username = `components-${suffix}`;
const password = randomBytes(20).toString("hex");
let accountToken, guild, app, browser, botGateway;
const results = [];
const log = (name) => {
    results.push(name);
    console.log(`PASS ${name}`);
};
const call = async (method, path, token, body) => {
    const form = body instanceof FormData;
    const response = await fetch(path.startsWith("http") ? path : `${api}${path}`, {
        method,
        headers: {
            ...(token ? { authorization: token } : {}),
            ...(!form && body ? { "content-type": "application/json" } : {}),
        },
        body: body ? (form ? body : JSON.stringify(body)) : undefined,
    });
    const text = await response.text();
    let parsed = null;
    try {
        parsed = text ? JSON.parse(text) : null;
    } catch {}
    if (response.status === 429) throw Error(`Rate limited: wait ${response.headers.get("retry-after") || parsed?.retry_after || "the reported interval"} before retrying`);
    return { status: response.status, body: parsed };
};
const success = (result, code = 200) => {
    assert.equal(result.status, code, `Expected ${code}; received ${result.status}, API code ${result.body?.code ?? "none"}`);
    return result.body;
};
const text = (content) => ({ type: 10, content });
const button = (custom_id) => ({ type: 2, style: 1, label: "Native component button", custom_id });
const connect = async (token) => {
    const ws = new WebSocket(`ws://localhost:${port}/?encoding=json&v=9`, {
        headers: { "user-agent": "Mozilla/5.0 components-proof", origin },
    });
    const events = [];
    let interval;
    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            ws.close();
            reject(Error("Bot gateway READY timed out"));
        }, 15000);
        ws.on("error", reject);
        ws.on("message", (raw) => {
            const message = JSON.parse(raw.toString());
            if (message.op === 10) {
                interval = setInterval(() => ws.send(JSON.stringify({ op: 1, d: null })), message.d.heartbeat_interval);
                ws.send(
                    JSON.stringify({
                        op: 2,
                        d: { token, intents: 0, properties: { os: "Mac OS X", browser: "probe", device: "" } },
                    }),
                );
            }
            if (message.op === 0) {
                events.push(message);
                if (message.t === "READY") {
                    clearTimeout(timeout);
                    resolve();
                }
            }
        });
    });
    return {
        events,
        close: () => {
            clearInterval(interval);
            ws.close();
        },
    };
};
try {
    const registration = success(
        await call("POST", "/auth/register", null, {
            username,
            email: `${username}@fosscord.test`,
            password,
            consent: true,
            date_of_birth: "2000-01-01",
            captcha_key: await solveCap({ origin }),
        }),
    );
    accountToken = registration.token;
    assert.ok(accountToken);
    guild = success(await call("POST", "/guilds", accountToken, { name: username }), 201);
    const channels = success(await call("GET", `/guilds/${guild.id}/channels`, accountToken));
    const channel = channels.find((item) => item.type === 0);
    assert.ok(channel);
    app = success(await call("POST", "/applications", accountToken, { name: username }));
    const token = success(await call("POST", `/applications/${app.id}/bot/reset`, accountToken, {})).token;
    const bot = `Bot ${token}`;
    success(
        await call("POST", `/oauth2/authorize?client_id=${app.id}&scope=bot%20applications.commands&permissions=8`, accountToken, {
            guild_id: guild.id,
            permissions: "8",
            authorize: true,
        }),
    );
    botGateway = await connect(bot);
    log("isolated bot installation and gateway");
    const components = [
        {
            type: 17,
            id: 12,
            accent_color: 0x6655aa,
            components: [
                text("# Components v2 native proof"),
                {
                    type: 9,
                    components: [text("Section with local thumbnail")],
                    accessory: { type: 11, media: { url: "attachment://proof-logo.png" } },
                },
                {
                    type: 12,
                    items: [{ media: { url: "attachment://proof-logo.png" }, description: "Local proof pixel" }],
                },
                { type: 13, file: { url: "attachment://proof.txt" } },
                { type: 14, spacing: 2 },
                {
                    type: 9,
                    components: [text("Nested interactive accessory")],
                    accessory: { ...button(`native-${suffix}`), id: 0 },
                },
                {
                    type: 1,
                    components: [{ type: 3, custom_id: `select-${suffix}`, options: [{ label: "One", value: "one" }] }],
                },
            ],
        },
    ];
    const form = new FormData();
    form.append(
        "payload_json",
        JSON.stringify({
            flags: 32768,
            components,
            attachments: [
                { id: "0", filename: "proof-logo.png" },
                { id: "1", filename: "proof.txt" },
            ],
        }),
    );
    form.append(
        "files[0]",
        new Blob([readFileSync(new URL("../../assets/icon.png", import.meta.url))], {
            type: "image/png",
        }),
        "proof-logo.png",
    );
    form.append("files[1]", new Blob(["component attachment proof"], { type: "text/plain" }), "proof.txt");
    const message = success(await call("POST", `/channels/${channel.id}/messages`, bot, form));
    assert.equal(message.flags & 32768, 32768);
    assert.equal(message.components[0].id, 12);
    const file = message.components[0].components.find((item) => item.type === 13);
    assert.equal(file.name, "proof.txt");
    assert.equal(file.size, 26);
    assert.ok(file.file.attachment_id);
    assert.ok(message.components[0].components[1].accessory.media.proxy_url.startsWith(origin));
    const nested = message.components[0].components.find((item) => item.type === 9 && item.accessory.type === 2).accessory;
    assert.ok(nested.id > 0);
    log("all v2 layouts, generated IDs and authoritative local media metadata");
    for (const bad of [
        { content: "conflict" },
        { embeds: [{ title: "conflict" }] },
        { poll: { question: { text: "q" }, answers: [{ poll_media: { text: "a" } }] } },
        { sticker_ids: ["1"] },
    ])
        assert.equal(
            (
                await call("POST", `/channels/${channel.id}/messages`, bot, {
                    flags: 32768,
                    components: [text("valid")],
                    ...bad,
                })
            ).status,
            400,
        );
    log("v2 legacy field exclusions");
    const legacy = success(
        await call("POST", `/channels/${channel.id}/messages`, bot, {
            content: "legacy",
            embeds: [{ title: "legacy embed" }],
        }),
    );
    const promoted = success(
        await call("PATCH", `/channels/${channel.id}/messages/${legacy.id}`, bot, {
            content: null,
            embeds: [],
            flags: 32768,
            components: [text("Promoted v2 message")],
        }),
    );
    assert.equal(promoted.flags & 32768, 32768);
    assert.equal((await call("PATCH", `/channels/${channel.id}/messages/${legacy.id}`, bot, { flags: 0 })).status, 400);
    success(await call("PATCH", `/channels/${channel.id}/messages/${message.id}`, bot, { flags: 32772 }));
    log("legacy promotion, immutable v2 flag and existing media edit");
    const webhook = success(await call("POST", `/channels/${channel.id}/webhooks`, accountToken, { name: username }));
    const webhookMessage = success(
        await call("POST", `/webhooks/${webhook.id}/${webhook.token}?wait=true&with_components=true`, null, {
            flags: 32768,
            components: [{ type: 17, components: [text("Incoming webhook v2 container")] }],
        }),
    );
    assert.equal(webhookMessage.components[0].type, 17);
    assert.equal((await call("PATCH", `/webhooks/${webhook.id}/${webhook.token}/messages/${webhookMessage.id}?with_components=true`, null, { flags: 0 })).status, 400);
    log("incoming webhook container and immutable flag");
    browser = await chromium.launch({
        executablePath: chromiumPath(),
        headless: true,
    });
    const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        colorScheme: "dark",
    });
    await context.addInitScript((token) => localStorage.setItem("token", JSON.stringify(token)), accountToken);
    const page = await context.newPage();
    let errors = 0;
    let blockedExternal = 0;
    page.on("pageerror", () => errors++);
    await page.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (["http:", "https:"].includes(url.protocol) && url.origin !== origin) {
            blockedExternal++;
            return route.abort();
        }
        return route.continue();
    });
    await page.goto(`${origin}/channels/${guild.id}/${channel.id}`);
    await page.getByText("Components v2 native proof", { exact: true }).waitFor({ timeout: 45000 });
    await page.getByText("Section with local thumbnail", { exact: true }).waitFor();
    await page.getByText("proof.txt", { exact: true }).first().waitFor();
    await page.getByText("Incoming webhook v2 container", { exact: true }).waitFor();
    await page.waitForFunction(() => [...document.images].filter((image) => image.src.includes("/attachments/") && image.complete && image.naturalWidth > 1).length >= 2);
    log("native thumbnail and gallery images loaded from local attachments");
    await page.getByRole("button", { name: "Native component button", exact: true }).click();
    const start = Date.now();
    let event;
    while (Date.now() - start < 10000) {
        event = botGateway.events.find((item) => item.t === "INTERACTION_CREATE" && item.d.data?.custom_id === nested.custom_id);
        if (event) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(event, "Native nested button must reach bot gateway");
    assert.equal(event.d.data.id, nested.id);
    success(
        await call("POST", `/interactions/${event.d.id}/${event.d.token}/callback`, null, {
            type: 4,
            data: { flags: 32768, components: [text("Native v2 response received")] },
        }),
        204,
    );
    await page.getByText("Native v2 response received", { exact: true }).waitFor();
    assert.equal(
        (
            await call("PATCH", `/webhooks/${app.id}/${event.d.token}/messages/@original`, null, {
                flags: 0,
            })
        ).status,
        400,
    );
    success(
        await call("PATCH", `/webhooks/${app.id}/${event.d.token}/messages/@original`, null, {
            content: null,
            embeds: [],
            components: [{ type: 17, components: [text("Native v2 edited response received")] }],
        }),
    );
    await page.getByText("Native v2 edited response received", { exact: true }).waitFor();
    log("interaction response immutable flag and container edit");
    if (process.env.COMPONENTS_SHOT) await page.screenshot({ path: process.env.COMPONENTS_SHOT });
    console.log(
        JSON.stringify({
            nativeRender: true,
            nestedInteraction: true,
            pageErrors: errors,
            blockedExternal,
            checks: results.length,
        }),
    );
    log("native layouts, local file rendering and nested interaction callback");
} finally {
    await browser?.close();
    botGateway?.close();
    if (guild && accountToken) {
        const removed = await call("POST", `/guilds/${guild.id}/delete`, accountToken, { password });
        console.log(`fixture_guild_cleanup_status=${removed.status}`);
    }
    if (app && accountToken) {
        const removed = await call("POST", `/applications/${app.id}/delete`, accountToken, {});
        console.log(`fixture_application_cleanup_status=${removed.status}`);
    }
    if (accountToken) {
        const removed = await call("POST", "/users/@me/delete", accountToken, { password });
        console.log(`fixture_account_cleanup_status=${removed.status}`);
    }
}
