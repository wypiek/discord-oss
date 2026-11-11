import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import sharp from "sharp";
import { chromiumPath } from "../util/chromium.cjs";

const playwright = createRequire(path.join(homedir(), ".cache/fosscord-tools/package.json"))("playwright-core");
const origin = (process.env.ORIGIN || `http://fosscord.localhost:${process.env.PORT || 3290}`).replace(/\/$/, "");
assert.ok(["localhost", "fosscord.localhost", "127.0.0.1"].includes(new URL(origin).hostname), "Use a localhost demo fixture");
const account = parseEnv(String(fs.readFileSync(process.env.TEST_ACCOUNT_FILE || "scripts/dev/.test-account")));
const response = await fetch(`${origin}/api/v9/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: account.TEST_EMAIL, password: account.TEST_PASSWORD }),
});
assert.equal(response.status, 200, "Fixture login failed");
const { token } = await response.json();
const authorizedGet = async (endpoint) => {
    const result = await fetch(`${origin}/api/v9${endpoint}`, { headers: { authorization: token } });
    assert.equal(result.status, 200, "Fixture endpoint failed");
    return result.json();
};
const users = await authorizedGet("/admin/users?q=friend&limit=20");
const friend = users.users.find((user) => user.email === "friend@fosscord.test");
assert.ok(friend, "The local friend fixture is required");
const channels = await authorizedGet("/users/@me/channels");
const dm = channels.find((channel) => channel.recipients?.some((user) => user.id === friend.id));
assert.ok(dm, "An existing friend DM is required");
const catalog = await authorizedGet("/admin/store/catalog");
const frame = catalog.items.find((item) => item.type === 3 && /Vengeance.*Orange/i.test(item.name)) || catalog.items.find((item) => item.type === 3);
assert.ok(frame, "A profile frame fixture is required");
const banner = await sharp({
    create: { width: 600, height: 240, channels: 4, background: "#a00f46" },
})
    .png()
    .toBuffer();
const browser = await playwright.chromium.launch({
    headless: true,
    executablePath: chromiumPath(),
});
const artifactDirectory = process.env.MODAL_ARTIFACT_DIR;
if (artifactDirectory) fs.mkdirSync(artifactDirectory, { recursive: true });
const screenshot = async (page, name) => {
    if (artifactDirectory) await page.screenshot({ path: path.join(artifactDirectory, `${name}.png`) });
};
try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript((value) => localStorage.setItem("token", JSON.stringify(value)), token);
    await context.route("**/banners/**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: banner }));
    await context.route(`**/api/v9/users/${friend.id}/profile**`, async (route) => {
        const result = await route.fetch();
        const profile = await result.json();
        profile.user_profile.banner = "overlaytest";
        profile.user_profile.collectibles = [{ type: 3, sku_id: frame.sku_id, expires_at: null }];
        await route.fulfill({ response: result, json: profile });
    });
    const page = await context.newPage();
    await page.goto(`${origin}/channels/@me/${dm.id}`);
    await page.getByRole("textbox").last().waitFor();
    await page.locator(".fosscord-framed-sidebar").waitFor();
    await page.locator(".user-profile-sidebar [class*=banner]").last().click();
    await page.getByRole("button", { name: "Close", exact: true }).waitFor();
    assert.equal(await page.getByRole("dialog").count(), 1);
    assert.ok(await page.evaluate(() => document.elementFromPoint(1150, 430)?.closest('[role="dialog"]')), "Banner preview must cover the framed sidebar");
    await screenshot(page, "profile-banner-lightbox");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "User Settings", exact: true }).click();
    await page.getByText("Edit Profiles", { exact: true }).waitFor();
    if (await page.locator("dialog.fe2ee-dialog[open]").count()) await page.keyboard.press("Escape");
    await page.getByText("Edit Profiles", { exact: true }).click();
    const changeBanner = page.getByRole("button", { name: "Change Banner", exact: true }).last();
    await changeBanner.waitFor();
    const settingsWindow = page.getByRole("dialog").first();
    const settingsTextboxes = await settingsWindow.getByRole("textbox").count();
    assert.ok(settingsTextboxes > 1, "The profile display name input is required for the unsaved edit check");
    const profileInput = settingsTextboxes ? settingsWindow.getByRole("textbox").nth(1) : null;
    const originalInput = profileInput ? await profileInput.inputValue() : null;
    const unsavedValue = originalInput === null ? null : `${originalInput} unsaved`;
    if (profileInput) await profileInput.fill(unsavedValue);
    await changeBanner.click();
    await page.getByText("Select an Image", { exact: true }).waitFor();
    await page.waitForTimeout(300);
    assert.equal(await page.getByRole("dialog").count(), 2);
    const insideSettingsHit = await page.evaluate(() => document.elementFromPoint(400, 200)?.className);
    assert.ok(String(insideSettingsHit).includes("scrim__"), "The nested backdrop must cover the inactive settings window");
    await screenshot(page, "banner-picker");
    await page.mouse.click(400, 200);
    await page.getByText("Select an Image", { exact: true }).waitFor({ state: "hidden" });
    assert.equal(await page.getByRole("dialog").count(), 1, "Only the nested picker should close");
    if (profileInput) assert.equal(await profileInput.inputValue(), unsavedValue, "Closing the picker must preserve unsaved profile edits");
    await changeBanner.click();
    await page.getByText("Select an Image", { exact: true }).waitFor();
    await page.mouse.click(20, 200);
    await page.getByText("Select an Image", { exact: true }).waitFor({ state: "hidden" });
    assert.equal(await page.getByRole("dialog").count(), 1);
    await changeBanner.click();
    await page.getByText("Select an Image", { exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByText("Select an Image", { exact: true }).waitFor({ state: "hidden" });
    assert.equal(await page.getByRole("dialog").count(), 1);
    if (profileInput) await profileInput.fill(originalInput);
    await screenshot(page, "profile-editor-after-picker");
    console.log(
        JSON.stringify({
            status: "pass",
            bannerAboveFramedSidebar: true,
            nestedOutsideClick: true,
            outerOutsideClick: true,
            escapeClosesOnlyPicker: true,
            unsavedInputPreserved: profileInput !== null,
        }),
    );
} finally {
    try {
        await browser.close();
    } finally {
        const logout = await fetch(`${origin}/api/v9/auth/logout`, {
            method: "POST",
            headers: { authorization: token, "content-type": "application/json" },
            body: "{}",
        });
        assert.equal(logout.status, 204, "The smoke session must be revoked");
    }
}
