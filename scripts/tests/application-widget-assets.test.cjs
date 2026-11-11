const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync("dist/api/routes/applications/#application_id/widget-config.js", "utf8");
const fixture = () => {
    const handlers = {};
    const initial = ["used", "old", "new"].map((key) => ({ key, asset_id: key }));
    const app = {
        id: "111",
        owner_id: "owner",
        widget_public: false,
        widget_config: { config_id: "1", surfaces: {}, assets: initial, updated_at: "initial" },
    };
    const locks = [],
        deleted = [];
    let updates = 0,
        transactions = 0,
        fail = false,
        reupload = false;
    const manager = {
        findOne: async (_entity, options) => {
            locks.push(options.lock?.mode);
            return structuredClone(app);
        },
        update: async (_entity, _where, patch) => {
            updates++;
            if (fail) throw new Error("Persistence failed");
            Object.assign(app, structuredClone(patch));
        },
    };
    const Application = {
        findOne: async () => structuredClone(app),
        getRepository: () => ({
            manager: {
                transaction: async (work) => {
                    transactions++;
                    if (reupload && transactions === 2) app.widget_config.assets.push({ key: "old", asset_id: "old" });
                    const before = structuredClone(app);
                    try {
                        return await work(manager);
                    } catch (error) {
                        Object.assign(app, before);
                        throw error;
                    }
                },
            },
        }),
    };
    const modules = {
        tslib: require("tslib"),
        express: {
            Router: () => {
                for (const method of ["get", "put", "delete", "post"]) handlers[method] = {};
                return Object.fromEntries(Object.keys(handlers).map((method) => [method, (path, ...callbacks) => (handlers[method][path] = callbacks.at(-1))]));
            },
        },
        "image-size": () => ({ width: 1, height: 1 }),
        "@spacebar/api/middlewares": { route: () => () => {} },
        "@spacebar/database": { Application },
        "@spacebar/util": {
            DiscordApiErrors: {
                UNKNOWN_APPLICATION: new Error("Unknown"),
                ACTION_NOT_AUTHORIZED_ON_APPLICATION: new Error("Not owner"),
            },
            FieldErrors: (fields) => Object.assign(new Error("Invalid field"), { fields }),
            Snowflake: { generate: () => "1" },
            deleteFile: async (path) => deleted.push(path),
            handleFile: async () => "uploaded",
        },
        "@spacebar/api/util/handlers/ApplicationWidgets": {
            MAX_WIDGET_ASSETS: 20,
            parseWidgetSurfaces: (surfaces) => surfaces,
        },
    };
    vm.runInNewContext(source, {
        exports: {},
        require: (name) => {
            assert.ok(name in modules, name);
            return modules[name];
        },
        Buffer,
        console,
    });
    const req = {
        params: { application_id: "111" },
        user_id: "owner",
        body: {
            surfaces: {
                widget_top: {
                    components: {
                        image: { fields: { image: { value_type: "application_asset", value: "used" } } },
                    },
                },
            },
        },
    };
    let response, status;
    const res = {
        json: (value) => (response = value),
        sendStatus: (value) => (status = value),
        status: (value) => {
            status = value;
            return res;
        },
    };
    return {
        app,
        req,
        deleted,
        locks,
        run: async (method = "put") => {
            await handlers[method][method === "post" ? "/assets" : "/"](req, res);
            return { response, status };
        },
        counts: () => ({ updates, transactions }),
        fail: () => (fail = true),
        reupload: () => (reupload = true),
    };
};
test("widget saves retain unseen uploads while pruning replaced submitted images", async () => {
    const f = fixture();
    f.req.body.asset_keys = ["used", "old"];
    await f.run();
    assert.deepEqual(
        f.app.widget_config.assets.map((asset) => asset.key),
        ["used", "new"],
    );
    assert.deepEqual(f.deleted, ["/app-assets/111/old"]);
    assert.deepEqual(f.locks, ["pessimistic_write", "pessimistic_write"]);
});
test("widget saves retain images used by alternate draft layouts", async () => {
    const f = fixture();
    f.req.body.asset_keys = ["used", "old", "new"];
    f.req.body.retained_asset_keys = ["old"];
    await f.run();
    assert.deepEqual(
        f.app.widget_config.assets.map((asset) => asset.key),
        ["used", "old"],
    );
    assert.deepEqual(f.deleted, ["/app-assets/111/new"]);
});
test("legacy widget saves still prune unused images", async () => {
    const f = fixture();
    await f.run();
    assert.deepEqual(
        f.app.widget_config.assets.map((asset) => asset.key),
        ["used"],
    );
    assert.equal(f.deleted.length, 2);
});
test("widget cleanup rechecks images uploaded again before deleting their file", async () => {
    const f = fixture();
    f.req.body.asset_keys = ["used", "old"];
    f.reupload();
    await f.run();
    assert.deepEqual(f.deleted, []);
    assert.ok(f.app.widget_config.assets.some((asset) => asset.key === "old"));
});
test("invalid widget image snapshots reject without writes or file deletion", async () => {
    for (const field of ["asset_keys", "retained_asset_keys"])
        for (const raw of [null, "used", [1], [""], ["x".repeat(65)], Array(21).fill("used")]) {
            const f = fixture();
            f.req.body[field] = raw;
            await assert.rejects(f.run(), (error) => Boolean(error.fields?.[field]));
            assert.equal(f.counts().updates, 0);
            assert.deepEqual(f.deleted, []);
        }
});
test("widget persistence failures leave metadata and files intact", async () => {
    const f = fixture();
    f.fail();
    await assert.rejects(f.run(), /Persistence failed/);
    assert.deepEqual(
        f.app.widget_config.assets.map((asset) => asset.key),
        ["used", "old", "new"],
    );
    assert.deepEqual(f.deleted, []);
});
test("widget mutations reject non-owners before updates", async () => {
    for (const method of ["put", "delete", "post"]) {
        const f = fixture();
        f.req.user_id = "other";
        if (method === "post") f.req.body = { image: "invalid" };
        await assert.rejects(f.run(method), /Not owner/);
        assert.equal(f.counts().updates, 0);
        assert.deepEqual(f.deleted, []);
    }
});
test("widget deletion locks the row and cleans up its unreferenced files", async () => {
    const f = fixture();
    assert.equal((await f.run("delete")).status, 204);
    assert.equal(f.app.widget_config, null);
    assert.equal(f.deleted.length, 3);
    assert.deepEqual(f.locks, ["pessimistic_write", "pessimistic_write"]);
});
test("widget image uploads read and update metadata under the row lock", async () => {
    const f = fixture();
    f.req.body = { image: "data:image/png;base64,aA==" };
    assert.equal((await f.run("post")).status, 201);
    assert.ok(f.app.widget_config.assets.some((asset) => asset.key === "uploaded"));
    assert.deepEqual(f.locks, ["pessimistic_write"]);
});
