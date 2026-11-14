import { createRequire } from "node:module";
import { homedir } from "node:os";
import { readFileSync } from "node:fs";
import { chromiumPath } from "../util/chromium.cjs";

const require = createRequire(`${homedir()}/.cache/fosscord-tools/`);
const { chromium } = require("playwright-core");

const port = process.env.PORT || "3001";
const api = `http://localhost:${port}/api/v9`;
const origin = process.env.ORIGIN || `http://fosscord.localhost:${port}`;
const shots = process.env.SHOTS;
const game = {
    id: process.env.GAME_ID || "1402418491272986635",
    name: process.env.GAME_NAME || "Minecraft",
};

const accounts = Object.fromEntries(
    readFileSync(new URL("./.test-account", import.meta.url), "utf8")
        .trim()
        .split("\n")
        .map((line) => line.split("=")),
);

async function login(email, password) {
    const body = await fetch(`${api}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ login: email, password }),
    }).then((response) => response.json());
    if (!body.token) throw new Error(`login failed for ${email}`);
    return body.token;
}

const call = (token, path) => fetch(`${api}${path}`, { headers: { authorization: token } }).then((response) => response.json());

const playerToken = await login(accounts.TEST_EMAIL, accounts.TEST_PASSWORD);
const viewerToken = await login("friend@fosscord.test", accounts.FRIEND_PASSWORD);
const player = await call(playerToken, "/users/@me");
const [guild] = await call(viewerToken, "/users/@me/guilds");
const channel = (await call(viewerToken, `/guilds/${guild.id}/channels`)).find((x) => x.type === 0);

const results = { checks: {}, errors: [], failed: [] };
const check = (name, value, detail) => {
    results.checks[name] = value ? "pass" : "fail";
    if (detail !== undefined) results.checks[`${name} (detail)`] = detail;
};

const browser = await chromium.launch({ executablePath: chromiumPath(), headless: true });

async function open(token, label, bridge) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
    await context.addInitScript(
        ({ token, bridge, game }) => {
            localStorage.setItem("token", JSON.stringify(token));
            if (!bridge) return;
            const listeners = new Set();
            const detected = { pid: 4242, id: game.id, name: game.name, exePath: "/Applications/Fake Game.app/Contents/MacOS/fake", exeName: "fake", cmdLine: "" };
            const candidate = { pid: 4343, name: "Indie Game", exePath: "/Applications/Indie Game.app/Contents/MacOS/Indie Game", exeName: "Indie Game", cmdLine: "" };
            window.__gameWatches = [];
            window.DiscordOSS = {
                platform: "darwin",
                games: {
                    watch(options) {
                        window.__gameWatches.push(options);
                        if (!options) return;
                        const added = (options.overrides ?? [])
                            .filter((override) => override.exePath === candidate.exePath)
                            .map((override) => ({ ...candidate, name: override.name }));
                        setTimeout(() => {
                            for (const listener of listeners) listener({ games: [detected, ...added], candidates: options.candidates ? [candidate] : [] });
                        }, 300);
                    },
                    onUpdate(listener) {
                        listeners.add(listener);
                        return () => listeners.delete(listener);
                    },
                },
            };
        },
        { token, bridge, game },
    );
    const page = await context.newPage();
    page.on("pageerror", (error) => results.errors.push(`${label}: ${String(error.stack || error).slice(0, 300)}`));
    page.on("console", (message) => message.type() === "error" && results.errors.push(`${label}: ${message.text().slice(0, 300)}`));
    page.on(
        "response",
        (response) => response.status() >= 400 && results.failed.push(`${label}: ${response.status()} ${response.request().method()} ${response.url().replace(origin, "")}`),
    );
    return page;
}

const presences = [];
const playerPage = await open(playerToken, "player", true);
playerPage.on("websocket", (socket) =>
    socket.on("framesent", (frame) => {
        if (typeof frame.payload === "string" && frame.payload.includes('"op":3')) presences.push(JSON.parse(frame.payload).d);
    }),
);
await playerPage.goto(`${origin}/channels/${guild.id}/${channel.id}`);
const viewerPage = await open(viewerToken, "viewer", false);
await viewerPage.goto(`${origin}/channels/${guild.id}/${channel.id}`);
await playerPage.waitForTimeout(12000);

const sent = presences.flatMap((presence) => presence.activities ?? []).find((activity) => activity.type === 0);
check("player sends a Playing activity", sent?.application_id === game.id && sent?.name === game.name && !!sent?.timestamps?.start, sent);
const watches = await playerPage.evaluate(() => window.__gameWatches);
check(
    "plugin asks the bridge to watch",
    watches.some((options) => options && Array.isArray(options.overrides)),
    watches,
);
const panel = await playerPage.evaluate(() => document.querySelector('section[aria-label="User area"]')?.innerText ?? document.body.innerText.slice(0, 400));
results.checks["player user area"] = panel;

const stored = await call(viewerToken, `/guilds/${guild.id}/members/${player.id}`);
results.checks.member = stored?.user?.username;

const memberList = viewerPage.locator('[aria-label^="Members"]').first();
await viewerPage.waitForTimeout(2000);
const memberText = await memberList.innerText().catch(() => "");
check("viewer member list shows Playing", memberText.includes(game.name), memberText.slice(0, 300));
if (shots) await viewerPage.screenshot({ path: `${shots}/member-list.png` });

const member = memberList.getByText(player.username, { exact: false }).first();
await member.click().catch((error) => results.errors.push(`click member: ${error.message}`));
await viewerPage.waitForTimeout(2500);
const popout = viewerPage.locator('[role="dialog"]').last();
const popoutText = await popout.innerText().catch(() => "");
const icons = await viewerPage.evaluate(() => [...document.querySelectorAll('[role="dialog"] img')].map((image) => image.getAttribute("src")).filter(Boolean));
check("viewer profile popout shows the game", popoutText.includes(game.name), popoutText.slice(0, 400));
check(
    "viewer profile popout shows the game icon",
    icons.some((src) => src.includes(`app-icons/${game.id}/`)),
    icons,
);
const iconLoaded = await viewerPage.evaluate(
    (id) => [...document.querySelectorAll('[role="dialog"] img')].some((image) => image.src.includes(`app-icons/${id}/`) && image.complete && image.naturalWidth > 0),
    game.id,
);
check("the game icon loads", iconLoaded);
if (shots) await viewerPage.screenshot({ path: `${shots}/popout.png` });

if (process.env.GAME_PROFILE !== "0") {
    const trigger = popout.getByText(game.name, { exact: true }).first();
    await trigger.click().catch((error) => results.errors.push(`click game: ${error.message}`));
    await viewerPage.waitForTimeout(3000);
    const profileText = await viewerPage.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].map((dialog) => dialog.innerText).join("\n---\n"));
    check("game profile opens", profileText.includes(game.name) && profileText !== popoutText, profileText.slice(0, 800));
    check("game profile has no purchase buttons or developer portal link", !/Get Now|Buy|Orbs|Nitro|Game Shop|Claim it/.test(profileText));
    if (shots) await viewerPage.screenshot({ path: `${shots}/game-profile.png` });
    await viewerPage.keyboard.press("Escape");
}

const setShowCurrentGame = (value) => playerPage.evaluate((value) => window.Vencord.Api.UserSettings.getUserSettingLazy("status", "showCurrentGame").updateSetting(value), value);
const sentBefore = presences.length;
await setShowCurrentGame(false);
await playerPage.waitForTimeout(4000);
const hidden = presences.slice(sentBefore).at(-1);
check("turning off Share your detected activities stops sending the game", !!hidden && !(hidden.activities ?? []).some((activity) => activity.type === 0), hidden);
const hiddenText = await memberList.innerText().catch(() => "");
check("viewer no longer sees the game", !hiddenText.includes(game.name), hiddenText.slice(0, 200));
await setShowCurrentGame(true);
await playerPage.waitForTimeout(3000);
check(
    "turning it back on sends the game again",
    (presences.at(-1)?.activities ?? []).some((activity) => activity.type === 0 && activity.application_id === game.id),
);

await playerPage.locator('[aria-label="User Settings"]').first().click();
await playerPage.waitForTimeout(2000);
await playerPage.getByText("Registered Games", { exact: true }).first().click();
await playerPage.waitForTimeout(2000);
const settingsText = await playerPage.evaluate(() => document.body.innerText);
check(
    "Registered Games lists the running game",
    settingsText.includes("Now playing!") && settingsText.includes(game.name),
    settingsText.slice(settingsText.indexOf("Registered Games"), settingsText.indexOf("Registered Games") + 400),
);
try {
    await playerPage.getByText("Add it!", { exact: true }).first().click();
    await playerPage.waitForTimeout(1500);
    if (shots) await playerPage.screenshot({ path: `${shots}/add-game.png` });
    await playerPage.locator('[role="dialog"] [role="combobox"], [role="dialog"] [role="button"][aria-haspopup]').last().click({ timeout: 5000 });
    await playerPage.waitForTimeout(800);
    await playerPage.getByText("Indie Game", { exact: true }).last().click({ timeout: 5000 });
    await playerPage.waitForTimeout(500);
    await playerPage.getByRole("button", { name: "Add Game" }).last().click({ timeout: 5000 });
    await playerPage.waitForTimeout(2000);
} catch (error) {
    results.errors.push(`add game: ${error.message.split("\n")[0]}`);
    results.checks["add game popout"] = await playerPage.evaluate(() =>
        [...document.querySelectorAll('[role="dialog"]')].map((dialog) => dialog.outerHTML.slice(0, 1500)).join("\n"),
    );
}
const watchesAfter = await playerPage.evaluate(() => window.__gameWatches);
check(
    "adding a game sends it to the bridge as an override",
    watchesAfter.some((options) => options?.overrides?.some((override) => override.name === "Indie Game")),
    watchesAfter.at(-1),
);
const addedText = await playerPage.evaluate(() => document.body.innerText);
check("the added game shows under Registered Games", addedText.includes("Indie Game"));
if (shots) await playerPage.screenshot({ path: `${shots}/registered-games.png` });

await playerPage.keyboard.press("Escape");
results.failed = [...new Set(results.failed)].slice(0, 40);
results.errors = [...new Set(results.errors)].slice(0, 30);
console.log(JSON.stringify(results, null, 2));
await browser.close();
process.exit(Object.entries(results.checks).some(([, value]) => value === "fail") ? 1 : 0);
