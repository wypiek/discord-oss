import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { parseEnv } from "node:util";
import { solveCap } from "./cap-token.mjs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { chromiumPath } from "../util/chromium.cjs";
const require = createRequire(`${homedir()}/.cache/fosscord-tools/`);
const { chromium } = require("playwright-core");
const origin = `http://fosscord.localhost:${process.env.PORT || 3290}`;
const env = parseEnv(String(readFileSync(process.env.DOTENV_CONFIG_PATH || ".env")));
const database = process.env.DATABASE || env.DATABASE;
assert.equal(new URL(database).pathname, "/fosscord_codex_admin", "Use the isolated admin demo database");
assert.ok(["localhost", "127.0.0.1"].includes(new URL(database).hostname));
const { Client } = createRequire(import.meta.url)("pg");
const db = new Client({ connectionString: database });
const fixtures = [];
let fixtureChannel;
let fixtureGuild;
let fixtureSticker;
let page;
let peer;
const errors = [];
const browser = await chromium.launch({
    executablePath: chromiumPath(),
    headless: true,
});
try {
    await db.connect();
    const signup = async () => {
        const suffix = randomBytes(6).toString("hex");
        const fixture = {
            email: `sticker-smoke-${suffix}@fosscord.test`,
            password: `Aa2!${randomBytes(18).toString("hex")}`,
        };
        fixtures.push(fixture);
        const captcha_key = await solveCap({ origin, browser });
        const registered = await fetch(`${origin}/api/v9/auth/register`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                email: fixture.email,
                username: `sticker${suffix}`,
                password: fixture.password,
                date_of_birth: "2000-01-01",
                consent: true,
                captcha_key,
            }),
        });
        assert.equal(registered.status, 200, "Disposable Cap signup failed");
        fixture.token = (await registered.json()).token;
        const self = await fetch(`${origin}/api/v9/users/@me`, {
            headers: { authorization: fixture.token },
        });
        assert.equal(self.status, 200);
        fixture.id = (await self.json()).id;
        return fixture;
    };
    const viewer = await signup();
    const recipient = await signup();
    console.log(JSON.stringify({ fixturesCreated: 2 }));
    for (const [actor, target] of [
        [viewer, recipient],
        [recipient, viewer],
    ]) {
        const friendship = await fetch(`${origin}/api/v9/users/@me/relationships/${target.id}`, {
            method: "PUT",
            headers: { authorization: actor.token, "content-type": "application/json" },
            body: "{}",
        });
        assert.ok([200, 204].includes(friendship.status));
    }
    const dm = await fetch(`${origin}/api/v9/users/@me/channels`, {
        method: "POST",
        headers: { authorization: viewer.token, "content-type": "application/json" },
        body: JSON.stringify({ recipients: [recipient.id] }),
    });
    assert.equal(dm.status, 200);
    fixtureChannel = (await dm.json()).id;
    const peerDm = await fetch(`${origin}/api/v9/users/@me/channels`, {
        method: "POST",
        headers: { authorization: recipient.token, "content-type": "application/json" },
        body: JSON.stringify({ recipients: [viewer.id] }),
    });
    assert.equal(peerDm.status, 200);
    assert.equal((await peerDm.json()).id, fixtureChannel);
    const createdGuild = await fetch(`${origin}/api/v9/guilds`, {
        method: "POST",
        headers: { authorization: viewer.token, "content-type": "application/json" },
        body: JSON.stringify({ name: "Sticker Smoke Fixture" }),
    });
    assert.equal(createdGuild.status, 201);
    fixtureGuild = (await createdGuild.json()).id;
    const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB1sAAAAASUVORK5CYII=", "base64");
    const upload = new FormData();
    upload.set("name", "Local Smoke");
    upload.set("description", "Disposable local sticker");
    upload.set("tags", "wave");
    upload.set("file", new Blob([image], { type: "image/png" }), "local.png");
    const createdSticker = await fetch(`${origin}/api/v9/guilds/${fixtureGuild}/stickers`, {
        method: "POST",
        headers: { authorization: viewer.token },
        body: upload,
    });
    assert.equal(createdSticker.status, 200);
    fixtureSticker = (await createdSticker.json()).id;
    assert.equal((await fetch(`${origin}/stickers/${fixtureSticker}.png`)).status, 200);
    const nativeContext = await browser.newContext();

    page = await nativeContext.newPage();
    const endpoints = [];
    page.on("console", (message) => {
        if ((message.type() === "error" && /TypeError|ReferenceError|Cannot read/.test(message.text())) || message.text().startsWith("[e2ee]"))
            errors.push(
                message
                    .text()
                    .replace(/https?:\/\/\S+/g, "(url)")
                    .slice(0, 700),
            );
    });
    page.on("pageerror", (error) => errors.push(error.message.replace(/https?:\/\/\S+/g, "(url)").slice(0, 300)));
    page.on("response", (response) => {
        const url = new URL(response.url());
        if (url.pathname.includes("sticker")) endpoints.push({ path: url.pathname, status: response.status() });
    });
    const login = async (target, fixture) => {
        await target.goto(`${origin}/login`);
        await target.locator('input[name="email"]').fill(fixture.email);
        await target.locator('input[name="password"]').fill(fixture.password);
        await target.locator('button[type="submit"]').click();
        await target.getByRole("button", { name: "User Settings", exact: true }).waitFor({ timeout: 45000 });
        await target.goto(`${origin}/channels/@me/${fixtureChannel}`);
        await target.bringToFront();
        await target.locator('[contenteditable="true"][role="textbox"]').waitFor({ timeout: 45000 });
        await target.waitForFunction(() => window.__fosscordE2ee?.status?.()?.ready === true, null, {
            timeout: 45000,
        });
    };
    const peerContext = await browser.newContext();
    peer = await peerContext.newPage();
    await login(peer, recipient);
    await login(page, viewer);
    if (process.argv.includes("--trace")) {
        const self = await (await fetch(`${origin}/api/v9/users/@me`, { headers: { authorization: viewer.token } })).json();
        const native = await page.evaluate(() => {
            const webpack = window.Vencord.Webpack;
            const user = webpack.Common.UserStore.getCurrentUser();
            const premium = webpack.findByProps("canUseCustomStickersEverywhere");
            const entitlements = webpack.findStore("EntitlementStore");
            return {
                premiumType: user.premiumType,
                nativeCustomStickers: premium?.canUseCustomStickersEverywhere?.(user),
                nativePremiumFunctions: Object.keys(premium || {}).filter((k) => /Sticker/.test(k)),
                entitlementMethods: Object.keys(Object.getPrototypeOf(entitlements || {}) || {}).filter((k) => /entitlement/i.test(k)),
            };
        });
        console.log(JSON.stringify({ stickerEligibility: { wirePremiumType: self.premium_type, ...native } }));
    }
    await page.getByRole("button", { name: "Open sticker picker", exact: true }).click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: "/tmp/fosscord-sticker-picker.png" });
    assert.equal(await page.getByText(/Uh Oh!/i).count(), 0);
    const send = async (format, packName) => {
        if (packName) await page.getByRole("button", { name: packName, exact: true }).click();
        await page.waitForTimeout(600);
        const visibleIndex = await page.locator("[class*=stickerNode]").evaluateAll((nodes) =>
            nodes.findIndex((node) => {
                const rect = node.getBoundingClientRect();
                return rect.width > 60 && rect.top >= 300 && rect.bottom <= 600 && rect.left >= 460;
            }),
        );
        assert.ok(visibleIndex >= 0, "Visible sticker tile exists");
        const artwork = page.locator("[class*=stickerNode]").nth(visibleIndex);
        await artwork.waitFor();
        if (format === 1 || format === 2)
            await artwork.locator("img").evaluate((img) => {
                if (!img.complete || img.naturalWidth < 1) throw new Error("APNG did not decode");
            });
        else
            await artwork.locator("canvas").evaluate((canvas) => {
                if (canvas.width < 1 || canvas.height < 1) throw new Error("Lottie canvas missing");
            });
        await page.waitForTimeout(500);
        await page.screenshot({ path: `/tmp/fosscord-sticker-format-${format}.png` });
        if (!process.argv.includes("--send")) {
            console.log(JSON.stringify({ nativeStickerRender: format, localAsset: true }));
            return;
        }
        const responsePromise = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/v9/channels/${fixtureChannel}/messages` && r.request().method() === "POST", {
            timeout: 30000,
        });
        const [response] = await Promise.all([responsePromise, artwork.click()]);
        if (response.status() !== 200) {
            const failure = await response.json();
            console.log(
                JSON.stringify({
                    stickerSendFailure: {
                        status: response.status(),
                        code: failure.code,
                        message: failure.message,
                    },
                }),
            );
        }
        assert.equal(response.status(), 200);
        const message = await response.json();
        assert.ok(message.encrypted?.ct, "Response carries an encrypted envelope");
        const stored = (await db.query("SELECT encrypted FROM messages WHERE id=$1 AND channel_id=$2", [message.id, fixtureChannel])).rows[0];
        assert.ok(stored?.encrypted?.ct, "Stored message retains an encrypted envelope");
        await peer.bringToFront();
        await peer.waitForFunction(
            ({ channel, id, format }) => {
                const record = window.Vencord.Webpack.Common.MessageStore.getMessage(channel, id);
                return record?.stickerItems?.some((item) => item.format_type === format);
            },
            { channel: fixtureChannel, id: message.id, format },
            { timeout: 30000 },
        );
        const received = peer.locator(`[id="chat-messages-${fixtureChannel}-${message.id}"]`);
        await received.waitFor({ timeout: 20000 });
        if (format === 3) await received.locator("canvas").waitFor();
        else
            await received.locator('img[src*="/stickers/"]').evaluate((img) => {
                if (!img.complete || img.naturalWidth < 1) throw new Error("Received sticker did not decode");
            });
        await peer.screenshot({ path: `/tmp/fosscord-sticker-received-${format}.png` });
        console.log(
            JSON.stringify({
                nativeStickerSend: format,
                status: response.status(),
                persistedSticker: true,
            }),
        );
    };
    for (const [format, pack] of [
        [3, "Robo Nelly"],
        [2, "Lonely Leif"],
        [1, "Sticker Smoke Fixture"],
    ]) {
        if (!(await page.getByRole("button", { name: pack, exact: true }).isVisible())) await page.getByRole("button", { name: "Open sticker picker", exact: true }).click();
        await send(format, pack);
    }

    console.log(
        JSON.stringify({
            errors,
            endpoints,
            failure: await page.getByText(/Uh Oh!/i).count(),
            buttons: await page.locator("[class*=sticker] button,[class*=sticker] [role=button]").count(),
        }),
    );
} catch (error) {
    if (page) {
        await page.screenshot({ path: "/tmp/sticker-smoke-failure.png" });
        console.log(
            JSON.stringify({
                failedPath: new URL(page.url()).pathname,
                visibleDialogCount: await page.getByRole("dialog").count(),
            }),
        );
    }
    console.log(
        JSON.stringify({
            errorMessage: error.message,
            errors,
            encryptionReady: await page?.evaluate(() => ({
                ready: window.__fosscordE2ee?.status?.()?.ready,
                encryptedChannels: window.__fosscordE2ee?.status?.()?.encryptedChannels?.length,
            })),
        }),
    );
    throw error;
} finally {
    try {
        await browser.close();
    } finally {
        await db.query("BEGIN");
        try {
            if (fixtureChannel) {
                const recipients = await db.query("SELECT user_id FROM recipients WHERE channel_id = $1", [fixtureChannel]);
                assert.equal(recipients.rows.length, 2);
                assert.ok(
                    recipients.rows.every((row) => fixtures.some((fixture) => fixture.id === row.user_id)),
                    "Delete only our synthetic DM",
                );
                await db.query("DELETE FROM channels WHERE id = $1", [fixtureChannel]);
            }
            for (const fixture of fixtures) {
                const row = await db.query('SELECT id, "settingsIndex" FROM users WHERE email = $1', [fixture.email]);
                if (!row.rows.length) continue;
                assert.equal(row.rows.length, 1);
                const id = row.rows[0].id;
                if (fixture.id) assert.equal(id, fixture.id);
                if (fixtureSticker && fixture.id === fixtures[0].id) {
                    const sticker = await db.query("SELECT id,guild_id FROM stickers WHERE id=$1", [fixtureSticker]);
                    assert.equal(sticker.rows[0]?.guild_id, fixtureGuild);
                    await unlink(path.join(path.dirname(process.env.DOTENV_CONFIG_PATH), "files", "stickers", fixtureSticker));
                }
                const guilds = await db.query("SELECT id,name FROM guilds WHERE owner_id=$1", [id]);
                for (const guild of guilds.rows) {
                    assert.equal(guild.name, "Sticker Smoke Fixture");
                    await db.query("DELETE FROM guilds WHERE id=$1 AND owner_id=$2", [guild.id, id]);
                }
                await db.query("DELETE FROM audit_logs WHERE user_id = $1", [id]);
                await db.query("DELETE FROM user_settings_protos WHERE user_id = $1", [id]);
                await db.query("DELETE FROM users WHERE id = $1 AND email = $2", [id, fixture.email]);
                if (row.rows[0].settingsIndex != null) await db.query('DELETE FROM user_settings WHERE "index" = $1', [row.rows[0].settingsIndex]);
                assert.equal(Number((await db.query("SELECT count(*) AS remaining FROM users WHERE id = $1", [id])).rows[0].remaining), 0);
            }
            await db.query("COMMIT");
        } catch (error) {
            await db.query("ROLLBACK");
            throw error;
        } finally {
            await db.end();
        }
    }
}
