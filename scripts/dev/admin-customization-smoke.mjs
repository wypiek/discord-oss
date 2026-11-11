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
const login = await fetch(`${origin}/api/v9/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: account.TEST_EMAIL, password: account.TEST_PASSWORD }),
});
assert.equal(login.status, 200);
const { token } = await login.json();
const request = async (path, method = "GET", body) => {
    const response = await fetch(`${origin}/api/v9${path}`, {
        method,
        headers: { authorization: token, "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
    });
    assert.ok(response.ok, `${method} ${path}: ${response.status}`);
    return response.status === 204 ? null : response.json();
};
const browser = await chromium.launch({
    executablePath: chromiumPath(),
    headless: true,
});
let packId, guildId, builtinSku;
try {
    const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        colorScheme: "dark",
    });
    await context.addInitScript((token) => localStorage.setItem("admin_token", token), token);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const save = async (form, name, path, method) => {
        const response = page.waitForResponse((response) => response.url().endsWith(path) && response.request().method() === method);
        await form.getByRole("button", { name, exact: true }).click();
        const result = await response;
        assert.equal(result.status(), method === "POST" ? 201 : 200);
        return result.json();
    };
    await page.goto(`${origin}/admin/#/store`);
    await page.getByRole("heading", { name: "Store", exact: true }).waitFor();
    await page.getByRole("button", { name: "Add pack", exact: true }).click();
    let form = page.locator("#pack-form");
    await form.locator('[name="name"]').fill("Dashboard browser pack");
    await form.locator('[name="summary"]').fill("Initial summary");
    const pack = await save(form, "Add pack", "/admin/store/packs", "POST");
    packId = pack.id;
    await page.locator("#item-new").waitFor();
    form = page.locator("#pack-form");
    await form.locator('[name="name"]').fill("Dashboard browser pack edited");
    await form.locator('[name="summary"]').fill("Edited summary");
    await form.locator('[name="position"]').fill("-15");
    const edited = await save(form, "Save pack", `/admin/store/packs/${packId}`, "PATCH");
    assert.equal(edited.name, "Dashboard browser pack edited");
    assert.equal(edited.summary, "Edited summary");
    assert.equal(edited.position, -15);
    await page.locator("#item-new").click();
    form = page.locator("#store-item-form");
    await form.locator('[name="name"]').fill("Dashboard browser decoration");
    const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jIWsAAAAASUVORK5CYII=", "base64");
    await form.locator('[data-art="image"]').setInputFiles({ name: "decoration.png", mimeType: "image/png", buffer: image });
    await form.locator('[name="position"]').fill("-9");
    const item = await save(form, "Add item", `/admin/store/packs/${packId}/items`, "POST");
    assert.equal(item.position, -9);
    await page.locator(`[data-item="${item.id}"]`).click();
    form = page.locator("#store-item-form");
    await form.locator('[name="name"]').fill("Edited browser decoration");
    await form.locator('[name="label"]').fill("A transparent test decoration");
    await form.locator('[name="position"]').fill("3");
    const editedItem = await save(form, "Save", `/admin/store/items/${item.id}`, "PATCH");
    assert.equal(editedItem.position, 3);
    assert.equal(editedItem.label, "A transparent test decoration");
    await page.locator("#pack-form").waitFor();
    console.log("PASS browser custom pack create/edit and item upload/edit/order");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    const builtin = (await request("/admin/store")).builtin.find((pack) => !pack.customized && !pack.hidden);
    assert.ok(builtin);
    builtinSku = builtin.sku_id;
    await page.locator(`[data-edit-builtin="${builtinSku}"]`).click();
    form = page.locator("#builtin-pack-form");
    await form.locator('[name="name"]').fill("Browser edited mirrored pack");
    await form.locator('[data-art="banner"]').setInputFiles({ name: "banner.png", mimeType: "image/png", buffer: image });
    await form.locator('[name="summary"]').fill("Local mirrored summary");
    await form.locator('[name="position"]').fill("-20");
    const customized = await save(form, "Save pack", `/admin/store/builtin/${builtinSku}`, "PATCH");
    assert.equal(customized.name, "Browser edited mirrored pack");
    assert.equal(customized.summary, "Local mirrored summary");
    assert.equal(customized.position, -20);
    assert.ok(new URL(customized.banner, origin).pathname.startsWith("/media/v1/collectibles-shop/builtin/"));
    await page.locator('#builtin-pack-form [data-art-remove="banner"]').click();
    const keepChanges = (dialog) => dialog.dismiss();
    page.on("dialog", keepChanges);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    assert.equal(await page.locator("#drawer").isVisible(), true);
    page.off("dialog", keepChanges);
    page.once("dialog", (dialog) => dialog.accept());
    const resetResponse = page.waitForResponse((response) => response.url().endsWith(`/admin/store/builtin/${builtinSku}`) && response.request().method() === "PATCH");
    await page.getByRole("button", { name: "Restore defaults", exact: true }).click();
    const restored = await (await resetResponse).json();
    assert.equal(restored.customized, false);
    assert.equal(restored.name, builtin.name);
    assert.equal(restored.banner, builtin.banner);
    builtinSku = undefined;
    await page.locator('#builtin-pack-form [name="name"]').waitFor();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    console.log("PASS browser mirrored pack edit/upload, dirty artwork protection and restore defaults");
    const guild = await request("/guilds", "POST", { name: "Dashboard browser server" });
    guildId = guild.id;
    await page.goto(`${origin}/admin/#/guilds`);
    await page.getByRole("heading", { name: "Servers", exact: true }).waitFor();
    await page.locator("#guild-search").fill("Dashboard browser server");
    await page.locator("#guild-results tbody tr").first().click();
    await page.locator("#server-resources summary").click();
    await page.locator("[data-create-channel]").click();
    form = page.locator("#admin-channel-form");
    await form.locator('[name="name"]').fill("browser-category");
    await form.locator('[name="type"]').selectOption("4");
    assert.equal(await form.locator('[name="parent_id"]').isDisabled(), true);
    const category = await save(form, "Create channel", `/admin/guilds/${guildId}/channels`, "POST");
    await page.locator(`[data-edit-channel="${category.id}"]`).waitFor();
    assert.equal(await page.locator("#server-resources").evaluate((element) => element.open), true);
    await page.locator("[data-create-channel]").click();
    form = page.locator("#admin-channel-form");
    await form.locator('[name="name"]').fill("browser-voice");
    await form.locator('[name="type"]').selectOption("2");
    await form.locator('[name="parent_id"]').selectOption(category.id);
    await form.locator('[name="user_limit"]').fill("12");
    const voice = await save(form, "Create channel", `/admin/guilds/${guildId}/channels`, "POST");
    assert.equal(voice.type, 2);
    assert.equal(voice.parent_id, category.id);
    assert.equal(voice.user_limit, 12);
    await page.locator("[data-create-role]").click();
    form = page.locator("#admin-role-form");
    await form.locator('[name="name"]').fill("Browser role");
    await form.locator('[name="mentionable"]').check();
    const role = await save(form, "Create role", `/admin/guilds/${guildId}/roles`, "POST");
    assert.equal(role.permissions, "0");
    assert.equal(role.mentionable, true);
    await page.locator(`[data-edit-role="${role.id}"]`).waitFor();
    assert.equal(await page.locator("#server-resources").evaluate((element) => element.open), true);
    await page.locator("#server-resources").scrollIntoViewIfNeeded();
    assert.ok((await page.locator("#toasts .toast").count()) <= 3);
    await page.screenshot({ path: "/tmp/fosscord-admin-resources.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: "/tmp/fosscord-admin-resources-mobile.png", fullPage: true });
    assert.deepEqual(errors, []);
    console.log("PASS browser category/voice/role creation, refreshed lists and mobile layout");
} finally {
    await browser.close();
    if (builtinSku) await request(`/admin/store/builtin/${builtinSku}`, "PATCH", { reset: true, hidden: false });
    if (packId) await request(`/admin/store/packs/${packId}`, "DELETE");
    if (guildId) await request(`/guilds/${guildId}/delete`, "POST");
}
