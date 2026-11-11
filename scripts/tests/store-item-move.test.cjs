const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
function harness() {
    let handler,
        saves = 0,
        reloads = 0,
        lookups = 0,
        artCalls = 0;
    const item = {
        id: "111",
        pack_id: "222",
        type: 1,
        name: "Effect",
        summary: "Summary",
        label: "Accessible effect",
        position: 7,
        data: { assets: { effect: "art", thumbnail: "preview" }, duration: 2400, loop: false },
    };
    item.save = async () => {
        saves++;
    };
    const module = { exports: {} };
    const file = "src/api/routes/admin/store/items/#item_id.ts";
    const js = ts.transpileModule(fs.readFileSync(file, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(js, {
        module,
        exports: module.exports,
        require(name) {
            if (name === "express")
                return {
                    Router: () => ({
                        patch: (_path, options, fn) => {
                            assert.equal(options.right, "OPERATOR");
                            handler = fn;
                        },
                        delete() {},
                    }),
                };
            if (name === "@spacebar/api/middlewares") return { route: (options) => options };
            if (name === "@spacebar/database")
                return {
                    StoreItem: { findOneOrFail: async () => item },
                    StorePack: {
                        existsBy: async ({ id }) => {
                            lookups++;
                            return id === "333";
                        },
                    },
                };
            if (name === "@spacebar/util")
                return {
                    Collectibles: {
                        reload: () => {
                            reloads++;
                        },
                    },
                };
            if (name === "@spacebar/api/util")
                return {
                    applyStoreItemSettings() {},
                    assertKeepsMainArt() {},
                    applyStoreArt: async (_item, art) => {
                        assert.equal(art, undefined);
                        artCalls++;
                    },
                    serializeStoreItem: (value) => JSON.parse(JSON.stringify(value)),
                };
            if (name === "lambert-server/HTTPError")
                return {
                    HTTPError: class extends Error {
                        constructor(message, status) {
                            super(message);
                            this.status = status;
                        }
                    },
                };
            throw Error(name);
        },
    });
    let response;
    return {
        item,
        run: async (body) => {
            await handler(
                { params: { item_id: item.id }, body },
                {
                    json: (value) => {
                        response = value;
                    },
                },
            );
            return response;
        },
        counts: () => ({ saves, reloads, lookups, artCalls }),
    };
}
test("moving a custom collectible retains SKU, assets, settings and metadata and invalidates catalog once", async () => {
    const h = harness();
    const before = JSON.parse(JSON.stringify(h.item));
    const result = await h.run({ pack_id: "333" });
    assert.deepEqual(result, { ...before, pack_id: "333" });
    assert.deepEqual(h.counts(), { saves: 1, reloads: 1, lookups: 1, artCalls: 1 });
});
test("invalid and nonexistent destination packs fail before item mutation, save or art work", async () => {
    for (const [pack_id, status] of [
        ["444", 404],
        ["vendor-pack", 400],
        ["99999999999999999999", 400],
        ["", 400],
        [333, 400],
    ]) {
        const h = harness();
        const before = JSON.stringify(h.item);
        await assert.rejects(h.run({ pack_id, name: "Must not change" }), (error) => error.status === status);
        assert.equal(JSON.stringify(h.item), before);
        assert.equal(h.counts().saves, 0);
        assert.equal(h.counts().reloads, 0);
        assert.equal(h.counts().artCalls, 0);
    }
});
test("same-pack edits avoid destination reads and leading zero identifiers normalize", async () => {
    const h = harness();
    await h.run({ pack_id: "000222" });
    assert.equal(h.item.pack_id, "222");
    assert.equal(h.counts().lookups, 0);
    const other = harness();
    await other.run({ pack_id: "000333" });
    assert.equal(other.item.pack_id, "333");
    assert.equal(other.counts().lookups, 1);
});
