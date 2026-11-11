const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./helpers/route-harness.cjs");

function harness({ afterRead } = {}) {
    const files = new Map();
    const preferences = {};
    let next = 0;
    const background = [];
    const harvest = loadModule(
        "src/api/util/utility/harvest.ts",
        {
            typeorm: { In: (value) => value, LessThan: (value) => value },
            "@spacebar/cdn/util/Storage": {
                storage: {
                    set: async (path, data, principal) => {
                        assert.equal(principal, "user:1");
                        files.set(path, data);
                    },
                    delete: async (path) => {
                        files.delete(path);
                    },
                },
            },
            "@spacebar/database": {
                User: {
                    findOneOrFail: async ({ select }) => {
                        const user = { id: "1", email: "", username: "tester", account_preferences: { ...preferences } };
                        if (select?.account_preferences) await afterRead?.();
                        return user;
                    },
                    setHarvest: async (id, value, replacing) => {
                        const current = preferences.harvest;
                        const allowed =
                            "harvest_id" in replacing
                                ? current?.harvest_id === replacing.harvest_id
                                : !(current && [0, 1].includes(current.status) && current.updated_at > replacing.pending_since) &&
                                  (current?.harvest_id ?? null) === replacing.previous_id;
                        if (allowed) preferences.harvest = value;
                        return allowed;
                    },
                },
            },
            "@spacebar/util": {
                Config: { get: () => ({ general: { instanceName: "Meowcord" }, api: { endpointPublic: "http://localhost" } }) },
                Email: {},
                Snowflake: { generate: () => String(100 + next++) },
                escapeHtml: (value) => value,
                trackBackground: (promise) => background.push(promise),
            },
            "@spacebar/schemas": { PrivateUserProjection: [] },
            "./mfa": { signTicket: () => "ticket" },
        },
        { setImmediate },
    );
    return {
        files,
        preferences,
        background,
        harvest,
        request: async () => {
            const created = await harvest.createHarvest("1", ["Zendesk"]);
            await Promise.all(background.splice(0));
            return created;
        },
    };
}

test("a new data package replaces the previous one instead of piling up in the account's storage", async () => {
    const { files, preferences, request } = harness();
    const first = await request();
    assert.deepEqual([...files.keys()], [`harvests/1/${first.harvest_id}.zip`]);
    const second = await request();
    assert.notEqual(second.harvest_id, first.harvest_id);
    assert.deepEqual([...files.keys()], [`harvests/1/${second.harvest_id}.zip`]);
    assert.equal(preferences.harvest.harvest_id, second.harvest_id);
    assert.equal(preferences.harvest.status, 3);
});

test("a second request while a package is still being built is refused", async () => {
    const { background, harvest, files } = harness();
    const first = await harvest.createHarvest("1", ["Zendesk"]);
    assert.equal(await harvest.createHarvest("1", ["Zendesk"]), null);
    await Promise.all(background.splice(0));
    assert.deepEqual([...files.keys()], [`harvests/1/${first.harvest_id}.zip`]);
});

test("a package left queued by a process that stopped can be requested again after an hour", async () => {
    const { preferences, request, files } = harness();
    preferences.harvest = { harvest_id: "50", status: 0, updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() };
    files.set("harvests/1/50.zip", Buffer.alloc(1));
    const created = await request();
    assert.notEqual(created, null);
    assert.equal(preferences.harvest.harvest_id, created.harvest_id);
    assert.equal(preferences.harvest.status, 3);
    assert.deepEqual([...files.keys()], [`harvests/1/${created.harvest_id}.zip`]);
});

test("a build that finishes after a newer request took its place deletes its own package", async () => {
    const { background, harvest, preferences, files } = harness();
    const stale = await harvest.createHarvest("1", ["Zendesk"]);
    preferences.harvest = { ...preferences.harvest, harvest_id: "60", status: 3 };
    await Promise.all(background.splice(0));
    assert.equal(preferences.harvest.harvest_id, "60");
    assert.ok(!files.has(`harvests/1/${stale.harvest_id}.zip`));
});

test("a package another request finished between reading the previous package and claiming the new one is deleted too", async () => {
    let raced = false;
    const state = {};
    const { files, preferences, request } = harness({
        afterRead: () => {
            if (raced) return;
            raced = true;
            state.files.delete("harvests/1/40.zip");
            state.files.set("harvests/1/41.zip", Buffer.alloc(1));
            state.preferences.harvest = { harvest_id: "41", status: 3, updated_at: new Date().toISOString() };
        },
    });
    Object.assign(state, { files, preferences });
    preferences.harvest = { harvest_id: "40", status: 3, updated_at: new Date().toISOString() };
    files.set("harvests/1/40.zip", Buffer.alloc(1));
    const created = await request();
    assert.notEqual(created, null);
    assert.equal(preferences.harvest.harvest_id, created.harvest_id);
    assert.deepEqual([...files.keys()], [`harvests/1/${created.harvest_id}.zip`]);
});

test("a request that loses its claim to a package still being built is refused", async () => {
    let raced = false;
    const state = {};
    const { preferences, harvest } = harness({
        afterRead: () => {
            if (raced) return;
            raced = true;
            state.preferences.harvest = { harvest_id: "42", status: 0, updated_at: new Date().toISOString() };
        },
    });
    state.preferences = preferences;
    assert.equal(await harvest.createHarvest("1", ["Zendesk"]), null);
    assert.equal(preferences.harvest.harvest_id, "42");
});
