const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const harness = () => {
    const requests = [];
    const profiles = new Map();
    const events = [];
    const module = { exports: {} };
    const source = fs.readFileSync("client/plugins/fosscordPride/index.tsx", "utf8") + "\nexport { refreshProfile, profileChanged };\n";
    const js = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            jsx: ts.JsxEmit.React,
        },
    }).outputText;
    vm.runInNewContext(js, {
        module,
        exports: module.exports,
        require(name) {
            if (name === "@utils/types")
                return {
                    __esModule: true,
                    default: (value) => value,
                    StartAt: { DOMContentLoaded: "DOMContentLoaded" },
                };
            if (name === "../fosscordCore/shared") return { FosscordAuthor: {} };
            if (name === "../fosscordCore/ui") return { Button: () => null, Field: () => null, SettingsSection: () => null };
            if (name === "./style.css?managed") return {};
            if (name === "./signup")
                return {
                    matches: () => true,
                    SignupPridePicker: () => null,
                    takeSignupSelection: () => undefined,
                };
            if (name === "@webpack/common")
                return {
                    RestAPI: {
                        get: ({ url }) => new Promise((resolve, reject) => requests.push({ url, resolve, reject })),
                    },
                    FluxDispatcher: {
                        dispatch: (event) => {
                            events.push(event);
                            profiles.set(event.userProfile.user.id, event.userProfile);
                        },
                    },
                    UserProfileStore: { getUserProfile: (id) => profiles.get(id) },
                };
            throw Error(name);
        },
    });
    const resolve = (index, selection) => {
        const id = requests[index].url.split("/")[2];
        requests[index].resolve({ body: { user: { id }, badges: selection } });
    };
    return { ...module.exports, requests, profiles, events, resolve };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("changed marker during a stale response triggers one latest fetch and callers await it", async () => {
    const h = harness();
    const first = h.refreshProfile("friend", "rainbow");
    const latest = h.refreshProfile("friend", "transgender");
    assert.equal(first, latest);
    let finished = false;
    latest.then(() => (finished = true));
    h.resolve(0, ["rainbow"]);
    await tick();
    assert.equal(h.requests.length, 2);
    assert.equal(finished, false);
    h.resolve(1, ["transgender"]);
    await latest;
    assert.deepEqual(h.profiles.get("friend").badges, ["transgender"]);
    assert.equal(finished, true);
});

test("hundreds of changed markers coalesce into one follow-up without an event queue", async () => {
    const h = harness();
    const first = h.refreshProfile("friend", "initial");
    for (let i = 0; i < 500; i++) assert.equal(h.refreshProfile("friend", `selection-${i}`), first);
    assert.equal(h.requests.length, 1);
    h.resolve(0, ["initial"]);
    await tick();
    assert.equal(h.requests.length, 2);
    h.resolve(1, ["selection-499"]);
    await first;
    assert.equal(h.requests.length, 2);
});

test("duplicate presence and member markers do not trigger redundant follow-up fetches", async () => {
    const h = harness();
    const first = h.refreshProfile("friend", "same");
    for (let i = 0; i < 100; i++) assert.equal(h.refreshProfile("friend", "same"), first);
    h.resolve(0, ["same"]);
    await first;
    assert.equal(h.requests.length, 1);
});

test("self-save refresh forces and awaits the latest fetch when an observer refresh is pending", async () => {
    const h = harness();
    const first = h.refreshProfile("self", "old");
    const save = h.refreshProfile("self");
    let finished = false;
    save.then(() => (finished = true));
    h.resolve(0, ["old"]);
    await tick();
    assert.equal(h.requests.length, 2);
    assert.equal(finished, false, "save waits until the latest response is applied");
    h.resolve(1, ["saved"]);
    await Promise.all([first, save]);
    assert.deepEqual(h.profiles.get("self").badges, ["saved"]);
});

test("failed stale fetch still retries a pending newer selection and releases state", async () => {
    const h = harness();
    const first = h.refreshProfile("friend", "old");
    h.refreshProfile("friend", "new");
    h.requests[0].reject(Error("old failed"));
    await tick();
    h.resolve(1, ["new"]);
    await first;
    const next = h.refreshProfile("friend", "newer");
    assert.equal(h.requests.length, 3);
    h.requests[2].reject(Error("latest failed"));
    await assert.rejects(next, /latest failed/);
    const retry = h.refreshProfile("friend", "retry");
    h.resolve(3, ["retry"]);
    await retry;
});

test("at most 32 users refresh concurrently, with capacity released after completion", async () => {
    const h = harness();
    const promises = Array.from({ length: 32 }, (_, i) => h.refreshProfile(`user-${i}`, "same"));
    await assert.rejects(h.refreshProfile("overflow", "same"), /capacity reached/);
    assert.equal(h.requests.length, 32);
    for (let i = 0; i < 32; i++) h.resolve(i, []);
    await Promise.all(promises);
    const next = h.refreshProfile("overflow", "same");
    h.resolve(32, []);
    await next;
});

test("event refreshes ignore uncached profiles and handle rejected requests", async () => {
    const h = harness();
    h.profileChanged({ user: { id: "uncached", pride_badges: ["rainbow"] } });
    assert.equal(h.requests.length, 0);
    h.profiles.set("friend", { user: { id: "friend" }, badges: [] });
    h.profileChanged({ updates: [{ user: { id: "friend", pride_badges: ["rainbow"] } }] });
    assert.equal(h.requests.length, 1);
    h.requests[0].reject(Error("network"));
    await tick();
    h.profileChanged({ user: { id: "friend", pride_badges: ["transgender"] } });
    assert.equal(h.requests.length, 2);
    h.resolve(1, ["transgender"]);
    await tick();
});

test("A to B to A then B during the follow-up applies the final B selection", async () => {
    const h = harness();
    const first = h.refreshProfile("friend", "A");
    h.refreshProfile("friend", "B");
    h.refreshProfile("friend", "A");
    h.resolve(0, ["A"]);
    await tick();
    assert.equal(h.requests.length, 2);
    const latest = h.refreshProfile("friend", "B");
    h.resolve(1, ["A"]);
    await tick();
    assert.equal(h.requests.length, 3, "final B marker must trigger a refetch of the stale A snapshot");
    h.resolve(2, ["B"]);
    await Promise.all([first, latest]);
    assert.deepEqual(h.profiles.get("friend").badges, ["B"]);
});
