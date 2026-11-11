import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { chromiumPath } from "../util/chromium.cjs";
const playwright = createRequire(path.join(homedir(), ".cache/fosscord-tools/package.json"))("playwright-core");
const origin = process.env.ORIGIN || `http://localhost:${process.env.PORT || 3413}`;
assert.ok(["localhost", "127.0.0.1", "fosscord.localhost"].includes(new URL(origin).hostname));
assert.ok(process.env.TEST_ACCOUNT_PATH);
const account = Object.fromEntries(
    readFileSync(process.env.TEST_ACCOUNT_PATH, "utf8")
        .trim()
        .split("\n")
        .map((line) => {
            const at = line.indexOf("=");
            return [line.slice(0, at), line.slice(at + 1)];
        }),
);
const call = async (method, pathname, token, body) => {
    const response = await fetch(`${origin}/api/v9${pathname}`, {
        method,
        headers: {
            ...(token && { authorization: token }),
            ...(body && { "content-type": "application/json" }),
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => null);
    return { status: response.status, data };
};
const login = await call("POST", "/auth/login", null, {
    login: account.TEST_EMAIL,
    password: account.TEST_PASSWORD,
});
assert.equal(login.status, 200);
assert.ok(login.data?.token);
const token = login.data.token;
const browserName = process.env.BROWSER || "chromium";
assert.ok(["chromium", "webkit"].includes(browserName));
let browser;
let guildId;
try {
    const guild = await call("POST", "/guilds", token, { name: "Native toast verification" });
    guildId = guild.data?.id;
    assert.equal(guild.status, 201);
    const role = await call("POST", `/guilds/${guildId}/roles`, token, {
        name: "Toast fixture",
        permissions: "0",
    });
    assert.equal(role.status, 200);
    browser = await playwright[browserName].launch(
        browserName === "chromium"
            ? {
                  executablePath: chromiumPath(),
                  headless: true,
              }
            : { headless: true },
    );
    const context = await browser.newContext();
    await context.addInitScript((token) => localStorage.setItem("token", JSON.stringify(token)), token);
    const page = await context.newPage();
    await page.goto(`${origin}/channels/@me`);
    await page.waitForFunction((guildId) => window.Vencord?.Webpack?.Common?.GuildStore?.getGuild(guildId) && window.Vencord?.Plugins?.plugins?.FosscordRoleTemplates, guildId, {
        timeout: 45000,
    });
    await page.evaluate(
        ({ guildId, roleId }) => {
            const V = window.Vencord;
            const mount = document.createElement("div");
            mount.id = "native-role-toast-verification";
            Object.assign(mount.style, {
                position: "fixed",
                inset: "100px",
                zIndex: "2147483646",
                background: "var(--background-base-lowest)",
            });
            document.body.append(mount);
            const root = V.Webpack.findByProps("createRoot").createRoot(mount);
            root.render(
                V.Plugins.plugins.FosscordRoleTemplates.renderTemplates({
                    guild: V.Webpack.Common.GuildStore.getGuild(guildId),
                    role: { id: roleId, permissions: 0n },
                    locked: false,
                }),
            );
            window.nativeToastCleanup = () => {
                root.unmount();
                mount.remove();
            };
        },
        { guildId, roleId: role.data.id },
    );
    await page.getByRole("button", { name: /^Member/ }).click();
    await page.getByText("Applied Member. Save to keep it.", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
    await page.evaluate(() => window.nativeToastCleanup());
    const current = await call("GET", `/guilds/${guildId}/roles`, token);
    assert.equal(current.status, 200);
    assert.equal(String(current.data.find((item) => item.id === role.data.id).permissions), "0");
    console.log(
        JSON.stringify({
            browser: browserName,
            nativeRoleTemplateToastVisible: true,
            draftNotPersistedWithoutSave: true,
        }),
    );
} finally {
    await browser?.close();
    if (guildId) assert.equal((await call("POST", `/guilds/${guildId}/delete`, token, {})).status, 204);
}
