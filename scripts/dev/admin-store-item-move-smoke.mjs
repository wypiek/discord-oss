import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { chromiumPath } from "../util/chromium.cjs";
const require = createRequire(`${homedir()}/.cache/fosscord-tools/`);
const { chromium } = require("playwright-core");

const origin = `http://localhost:${process.env.PORT || 3290}/api/v9`;
const account = Object.fromEntries(
    readFileSync(new URL("./.test-account", import.meta.url), "utf8")
        .trim()
        .split("\n")
        .map((line) => line.split("=")),
);
const login = await fetch(`${origin}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: account.TEST_EMAIL, password: account.TEST_PASSWORD }),
});
assert.equal(login.status, 200, "isolated demo login");
const { token } = await login.json();
const request = (path, { method = "GET", body, etag } = {}) =>
    fetch(origin + path, {
        method,
        cache: "force-cache",
        headers: {
            authorization: token,
            ...(body ? { "content-type": "application/json" } : {}),
            ...(etag ? { "if-none-match": etag } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });
const packs = [];
let browser;
try {
    for (const name of ["Move smoke source", "Move smoke destination"]) {
        const response = await request("/admin/store/packs", { method: "POST", body: { name } });
        assert.equal(response.status, 201);
        packs.push(await response.json());
    }
    const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jIWsAAAAASUVORK5CYII=";
    const created = await request(`/admin/store/packs/${packs[0].id}/items`, {
        method: "POST",
        body: {
            type: 1,
            name: "Move smoke effect",
            summary: "Preserved summary",
            label: "Preserved accessibility label",
            position: 7,
            duration: 2400,
            loop: false,
            art: { effect: image, thumbnail: image, reduced: image },
        },
    });
    assert.equal(created.status, 201);
    const item = await created.json();
    const vendor = (await (await request("/admin/store")).json()).builtin[0];
    assert.equal(
        (
            await request(`/admin/store/items/${item.id}`, {
                method: "PATCH",
                body: { pack_id: vendor.sku_id, name: "Must not change" },
            })
        ).status,
        404,
    );
    assert.equal(
        (
            await request(`/admin/store/items/${item.id}`, {
                method: "PATCH",
                body: { pack_id: "99999999999999999999" },
            })
        ).status,
        400,
    );
    const before = (await (await request("/admin/store")).json()).packs.find((pack) => pack.id === packs[0].id).items[0];
    assert.deepEqual(before, item);
    browser = await chromium.launch({
        executablePath: chromiumPath(),
        headless: true,
    });
    const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        colorScheme: "dark",
    });
    await context.addInitScript((token) => localStorage.setItem("token", JSON.stringify(token)), token);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://fosscord.localhost:${process.env.PORT || 3290}/admin/#/store`);
    await page.locator(`[data-pack="${packs[0].id}"]`).click();
    await page.locator(`[data-item="${item.id}"]`).click();
    await page.locator("#store-item-form select[name=pack_id]").selectOption(packs[1].id);
    await page.screenshot({ path: "/tmp/fosscord-item-move-selector.png", fullPage: true });
    const savedResponse = page.waitForResponse((response) => response.url().includes(`/admin/store/items/${item.id}`) && response.request().method() === "PATCH");
    await page.locator("#store-item-form button[type=submit]").click();
    const saved = await savedResponse;
    assert.equal(saved.status(), 200);
    const moved = await saved.json();
    assert.deepEqual(moved, { ...item, pack_id: packs[1].id });
    await page.locator("#pack-form input[name=name]").waitFor();
    assert.equal(await page.locator("#pack-form input[name=name]").inputValue(), packs[1].name);
    await page.locator(`[data-item="${item.id}"]`).waitFor();
    await page.screenshot({ path: "/tmp/fosscord-item-move-destination.png", fullPage: true });
    const store = await (await request("/admin/store")).json();
    assert.equal(store.packs.find((pack) => pack.id === packs[0].id).items.length, 0);
    assert.deepEqual(store.packs.find((pack) => pack.id === packs[1].id).items, [moved]);
    const product = await (await request(`/collectibles-products/${item.id}`)).json();
    assert.equal(product.category_sku_id, packs[1].id);
    assert.equal(product.sku_id, item.id);
    const catalog = await (await request("/admin/store/catalog")).json();
    assert.equal(catalog.items.find((entry) => entry.sku_id === item.id).pack, packs[1].name);
    for (const url of Object.values(moved.art))
        if (url) {
            const art = await fetch(`http://localhost:${process.env.PORT || 3290}${url}`);
            assert.equal(art.status, 200);
            await art.arrayBuffer();
        }
    assert.deepEqual(errors, []);
    console.log(
        "PASS live browser item move: destination selector, preserved effect artwork/settings/metadata, destination navigation, consistent source/destination/catalog/product, invalid destinations rejected",
    );
} finally {
    await browser?.close();
    for (const pack of packs) assert.equal((await request(`/admin/store/packs/${pack.id}`, { method: "DELETE" })).status, 204, "isolated fixture cleanup");
}
