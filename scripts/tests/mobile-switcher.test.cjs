const assert = require("node:assert/strict");
const test = require("node:test");
const { createInstanceSwitcher, hostOf, normalizeInstanceInput, originOf } = require("../../client/mobile/src/switcher.ts");

test("instance addresses become origins with the right scheme", () => {
    assert.equal(normalizeInstanceInput("chat.example.com"), "https://chat.example.com");
    assert.equal(normalizeInstanceInput(" https://Chat.Example.com/app/ "), "https://chat.example.com");
    assert.equal(normalizeInstanceInput("192.168.1.20:3001"), "http://192.168.1.20:3001");
    assert.throws(() => normalizeInstanceInput(""), /Enter the address/);
    assert.throws(() => normalizeInstanceInput("ftp://chat.example.com"), /Only http and https/);
    assert.equal(originOf("https://chat.example.com/api/v9"), "https://chat.example.com");
    assert.equal(hostOf("https://chat.example.com:8443"), "chat.example.com:8443");
});

const fakeFiles = (initial = {}) => {
    const files = new Map(Object.entries(initial));
    const removed = [];
    return {
        files,
        removed,
        module: {
            getConstants: () => ({ DocumentsDirPath: "/data/files" }),
            fileExists: async (path) => files.has(path),
            readFile: async (path) => files.get(path),
            writeFile: async (dir, relative, data) => files.set(`/data/files/${relative}`, data),
            removeFile: async (dir, relative) => removed.push(`${dir}:${relative}`),
        },
    };
};

test("switching points kettu at the new instance's bundle and reloads", async () => {
    const fs = fakeFiles({
        "/data/files/pyoncord/loader.json": JSON.stringify({ customLoadUrl: { enabled: true, url: "https://old.example/mobile/meowcord.js" }, loadReactDevTools: true }),
    });
    let reloaded = 0;
    globalThis.__PYON_LOADER__ = { loaderName: "Kettu" };
    globalThis.fetch = async (url, init) => {
        if (url === "https://new.example/.well-known/discord-oss")
            return { ok: true, status: 200, json: async () => ({ software: { name: "discord-oss" }, instance: { url: "https://new.example", name: "New" } }) };
        if (url === "https://new.example/mobile/meowcord.js" && init?.method === "HEAD") return { ok: true, status: 200 };
        return { ok: false, status: 404, json: async () => null };
    };
    const modules = { NativeFileModule: fs.module, BundleUpdaterManager: { reload: () => reloaded++ } };
    const react = { createElement: () => null, useState: (value) => [value, () => {}], useEffect: () => {} };
    const switcher = createInstanceSwitcher({ currentOrigin: "https://old.example", nativeModule: (name) => modules[name] ?? null, log: () => {} });
    switcher.inspect(react);
    assert.equal(typeof globalThis.DiscordOSS.openInstanceSwitcher, "function");
    const registry = {
        registered: null,
        registerComponent(key, provider) {
            this.registered = provider;
        },
        runApplication() {},
    };
    const patched = switcher.inspect(registry);
    assert.equal(typeof patched.registerComponent, "function");

    const instance = await switcher.discover("new.example");
    assert.deepEqual(instance, { url: "https://new.example", name: "New" });
    await switcher.switchTo(instance);
    assert.deepEqual(JSON.parse(fs.files.get("/data/files/pyoncord/loader.json")), {
        loadReactDevTools: true,
        customLoadUrl: { enabled: true, url: "https://new.example/mobile/meowcord.js" },
    });
    assert.deepEqual(
        JSON.parse(fs.files.get("/data/files/discord-oss/instances.json")).map((item) => item.url),
        ["https://new.example", "https://old.example"],
    );
    assert.deepEqual(fs.removed, ["cache:pyoncord/bundle.js"]);
    assert.equal(reloaded, 1);

    await assert.rejects(switcher.discover("plain.example"), /isn't a Discord OSS instance/);
    delete globalThis.__PYON_LOADER__;
});
