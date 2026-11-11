import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
let sku;
let original;
try {
    const response = await request("/admin/store");
    assert.equal(response.status, 200);
    const store = await response.json();
    original = store.builtin.find((pack) => !pack.customized && !pack.hidden);
    assert.ok(original, "Need a visible uncustomized vendor pack on the isolated demo");
    sku = original.sku_id;
    const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jIWsAAAAASUVORK5CYII=";
    const changed = await request(`/admin/store/builtin/${sku}`, {
        method: "PATCH",
        body: {
            name: "Local builtin smoke name",
            summary: "Local smoke summary",
            position: -10,
            banner_data: image,
            logo_data: image,
        },
    });
    assert.equal(changed.status, 200);
    const pack = await changed.json();
    assert.equal(pack.customized, true);
    assert.equal(pack.hidden, false);
    assert.equal(pack.name, "Local builtin smoke name");
    assert.equal(pack.summary, "Local smoke summary");
    assert.equal(pack.position, -10);
    for (const field of ["banner", "logo"]) {
        assert.ok(pack[field].includes(`/collectibles-shop/builtin/${sku}/`));
        const art = await fetch(pack[field]);
        assert.equal(art.status, 200);
        assert.match(art.headers.get("content-type"), /^image\//);
        await art.arrayBuffer();
    }
    const listed = (await (await request("/admin/store")).json()).builtin.find((entry) => entry.sku_id === sku);
    for (const field of ["name", "summary", "position", "banner", "logo", "customized", "hidden"]) assert.deepEqual(listed[field], pack[field]);
    const hiddenResponse = await request(`/admin/store/builtin/${sku}`, {
        method: "PATCH",
        body: { hidden: true },
    });
    assert.equal(hiddenResponse.status, 200);
    const hidden = await hiddenResponse.json();
    assert.equal(hidden.hidden, true);
    assert.equal(hidden.name, pack.name);
    const restoredArt = await request(`/admin/store/builtin/${sku}`, {
        method: "PATCH",
        body: { banner_data: null, logo_data: null },
    });
    assert.equal(restoredArt.status, 200);
    const vendorArt = await restoredArt.json();
    assert.equal(vendorArt.banner, original.banner);
    assert.equal(vendorArt.logo, original.logo);
    const reset = await request(`/admin/store/builtin/${sku}`, {
        method: "PATCH",
        body: { reset: true },
    });
    assert.equal(reset.status, 200);
    assert.equal((await reset.json()).hidden, true);
    const visible = await request(`/admin/store/builtin/${sku}`, {
        method: "PATCH",
        body: { hidden: false },
    });
    assert.equal(visible.status, 200);
    const final = await visible.json();
    for (const field of ["name", "summary", "position", "banner", "logo", "customized", "hidden"]) assert.deepEqual(final[field], original[field]);
    sku = undefined;
    console.log(
        "PASS live builtin pack editing: metadata, sorting, uploaded banner/logo served locally, visibility preserves edits, null artwork restores vendor, reset preserves visibility and cleanup",
    );
} finally {
    if (sku)
        assert.equal(
            (
                await request(`/admin/store/builtin/${sku}`, {
                    method: "PATCH",
                    body: { reset: true, hidden: original.hidden },
                })
            ).status,
            200,
        );
}
