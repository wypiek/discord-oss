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
const catalog = () => request("/admin/store/catalog");
let packId;
try {
    assert.equal((await fetch(`${origin}/admin/store/catalog`)).status, 401, "catalog remains authenticated");
    const before = await catalog();
    assert.equal(before.status, 200);
    const baseline = await before.json();
    const originalEtag = before.headers.get("etag");
    assert.ok(originalEtag);
    assert.equal(before.headers.get("cache-control"), "private, no-cache");
    const unchanged = await request("/admin/store/catalog", { etag: originalEtag });
    assert.equal(unchanged.status, 304);
    assert.equal(await unchanged.text(), "");
    const pack = await request("/admin/store/packs", {
        method: "POST",
        body: { name: "Catalog smoke isolated pack" },
    });
    assert.equal(pack.status, 201);
    packId = (await pack.json()).id;
    const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jIWsAAAAASUVORK5CYII=";
    const created = await request(`/admin/store/packs/${packId}/items`, {
        method: "POST",
        body: { type: 0, name: "Catalog smoke original", art: { image } },
    });
    assert.equal(created.status, 201);
    const item = await created.json();
    const added = await request("/admin/store/catalog", { etag: originalEtag });
    assert.equal(added.status, 200);
    const addedEtag = added.headers.get("etag");
    assert.notEqual(addedEtag, originalEtag);
    const newCatalog = await added.json();
    assert.equal(newCatalog.items.length, baseline.items.length + 1);
    assert.equal(newCatalog.items.find((entry) => entry.sku_id === item.id)?.name, "Catalog smoke original");
    const edited = await request(`/admin/store/items/${item.id}`, {
        method: "PATCH",
        body: { name: "Catalog smoke edited" },
    });
    assert.equal(edited.status, 200);
    const afterEdit = await request("/admin/store/catalog", { etag: addedEtag });
    assert.equal(afterEdit.status, 200);
    assert.notEqual(afterEdit.headers.get("etag"), addedEtag);
    assert.equal((await afterEdit.json()).items.find((entry) => entry.sku_id === item.id)?.name, "Catalog smoke edited");
    assert.equal((await request(`/admin/store/packs/${packId}`, { method: "DELETE" })).status, 204);
    packId = undefined;
    const final = await catalog();
    assert.equal(final.status, 200);
    assert.equal(final.headers.get("etag"), originalEtag);
    assert.deepEqual(await final.json(), baseline);
    console.log("PASS live catalog: authenticated, conditional 304, custom upload/create, rename invalidation, deletion invalidation and cleanup");
} finally {
    if (packId) {
        const cleanup = await request(`/admin/store/packs/${packId}`, { method: "DELETE" });
        assert.equal(cleanup.status, 204, "cleanup isolated smoke pack");
    }
}
