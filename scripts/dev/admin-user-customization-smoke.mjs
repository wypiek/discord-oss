import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { chromiumPath } from "../util/chromium.cjs";
const require = createRequire(`${homedir()}/.cache/fosscord-tools/`);
const { chromium } = require("playwright-core");
const origin = `http://fosscord.localhost:${process.env.PORT || 3290}`;
const account = Object.fromEntries(
    readFileSync(process.env.TEST_ACCOUNT_FILE || new URL("./.test-account", import.meta.url), "utf8")
        .trim()
        .split("\n")
        .map((line) => line.split("=")),
);
const login = async (email, password) => {
    const response = await fetch(`${origin}/api/v9/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ login: email, password }),
    });
    assert.equal(response.status, 200);
    return response.json();
};
const [admin, friend] = await Promise.all([login(account.TEST_EMAIL, account.TEST_PASSWORD), login("friend@fosscord.test", account.FRIEND_PASSWORD)]);
const api = async (token, route, method = "GET", body) => {
    const response = await fetch(`${origin}/api/v9${route}`, {
        method,
        headers: { authorization: token, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
};
const self = await api(friend.token, "/users/@me");
const id = self.body.id;
const prefix = `/admin/users/${id}`;
const before = {};
for (const section of ["pride-badges", "widgets", "settings"]) {
    before[section] = (await api(admin.token, `${prefix}/${section}`)).body;
    assert.equal((await api(friend.token, `${prefix}/${section}`)).status, 403);
}
const browser = await chromium.launch({
    executablePath: chromiumPath(),
    headless: true,
});
try {
    assert.equal((await api(admin.token, `${prefix}/pride-badges`, "PATCH", { flags: ["unknown"] })).status, 400);
    assert.equal(
        (
            await api(admin.token, `${prefix}/pride-badges`, "PATCH", {
                flags: ["rainbow", "transgender"],
            })
        ).status,
        200,
    );
    const actualPride = await api(friend.token, "/users/@me/pride-badges");
    assert.deepEqual(actualPride.body.flags, ["rainbow", "transgender"]);
    assert.equal((await api(admin.token, `${prefix}/widgets`, "PUT", { widgets: before.widgets.widgets })).status, 200);
    assert.equal(
        (
            await api(admin.token, `${prefix}/settings`, "PATCH", {
                theme: "light",
                animate_emoji: false,
            })
        ).status,
        200,
    );
    const preferences = await api(friend.token, "/users/@me/settings");
    assert.equal(preferences.body.theme, "light");
    assert.equal(preferences.body.animate_emoji, false);
    assert.deepEqual((await api(friend.token, "/users/@me/pride-badges")).body.flags, ["rainbow", "transgender"]);
    const audit = await api(admin.token, `${prefix}/customization-audit`);
    assert.ok(audit.body.entries.some((entry) => entry.target_id === id && entry.options?.type === "client_preferences"));
    assert.ok(!JSON.stringify(audit.body).includes(account.TEST_PASSWORD));
    const context = await browser.newContext();
    await context.addInitScript((value) => localStorage.setItem("token", JSON.stringify(value)), admin.token);
    const page = await context.newPage();
    await page.goto(`${origin}/admin/#/users`);
    await page.locator("#user-search").waitFor({ timeout: 30000 });
    await page.locator("#user-search").fill(id);
    await page.locator(`tbody tr[data-id="${id}"]`).first().click();
    const panel = page.getByRole("region", { name: "User customization", exact: true });
    await panel.getByRole("button", { name: "Save pride badges", exact: true }).waitFor();
    assert.equal(await panel.getByRole("checkbox").count(), 40);
    await panel.getByRole("button", { name: "Save pride badges", exact: true }).click();
    await panel.getByText("Changes saved", { exact: true }).first().waitFor();
    console.log(
        JSON.stringify({
            target_scoped: true,
            regular_user_forbidden: true,
            invalid_flag_rejected: true,
            preference_native_sync: true,
            audit_recorded: true,
            admin_profile_controls_visible: true,
        }),
    );
} finally {
    await api(admin.token, `${prefix}/pride-badges`, "PATCH", {
        flags: before["pride-badges"].flags,
    });
    await api(admin.token, `${prefix}/widgets`, "PUT", { widgets: before.widgets.widgets });
    await api(admin.token, `${prefix}/settings`, "PATCH", {
        theme: before.settings.theme,
        animate_emoji: before.settings.animate_emoji,
    });
    await browser.close();
}
