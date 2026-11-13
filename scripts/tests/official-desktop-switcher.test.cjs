const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
execFileSync("bun", ["run", "build"], { cwd: path.join(__dirname, "..", "..", "apps", "official-desktop"), stdio: "ignore" });
const { backendSettings, currentInstance, discoverInstance, normalizeInstanceUrl, rememberInstance } = require("../../apps/official-desktop/src/instances.ts");
const { CHANNELS, LOADER_LINE, coreFolders, install, isInstalled, patchedLoader, uninstall, unpatchedLoader } = require("../../apps/official-desktop/src/install.ts");

test("instance addresses and backend settings", () => {
    assert.equal(normalizeInstanceUrl("discord.lifestyle"), "https://discord.lifestyle");
    assert.equal(normalizeInstanceUrl("localhost:3001"), "http://localhost:3001");
    const settings = { BACKGROUND_COLOR: "#202225", SKIP_HOST_UPDATE: true };
    const pointed = backendSettings(settings, "https://discord.lifestyle");
    assert.deepEqual(pointed, { ...settings, WEBAPP_ENDPOINT: "https://discord.lifestyle", API_ENDPOINT: "https://discord.lifestyle/api" });
    assert.equal(currentInstance(pointed), "https://discord.lifestyle");
    assert.deepEqual(backendSettings(pointed, null), settings);
    assert.equal(currentInstance(settings), null);
    const list = rememberInstance(
        [
            { url: "https://a.example", name: "A" },
            { url: "https://b.example", name: "B" },
        ],
        { url: "https://b.example", name: "B" },
    );
    assert.deepEqual(
        list.map((item) => item.url),
        ["https://b.example", "https://a.example"],
    );
});

test("discovery accepts only discord oss instances", async () => {
    const fetcher = async (url) =>
        url === "https://discord.lifestyle/.well-known/discord-oss"
            ? { ok: true, status: 200, json: async () => ({ software: { name: "discord-oss" }, instance: { url: "https://discord.lifestyle", name: "Discord OSS" } }) }
            : { ok: false, status: 404, json: async () => null };
    assert.deepEqual(await discoverInstance("discord.lifestyle", fetcher), { url: "https://discord.lifestyle", name: "Discord OSS" });
    await assert.rejects(discoverInstance("example.com", fetcher), /isn't a Discord OSS instance/);
});

test("the loader line is added once and removed cleanly", () => {
    const original = "module.exports = require('./core.asar');";
    const patched = patchedLoader(original);
    assert.equal(patched, `${LOADER_LINE}\n${original}`);
    assert.equal(patchedLoader(patched), patched);
    assert.equal(unpatchedLoader(patched), original);
});

test("install finds a channel's desktop core and patches it", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "discord-oss-switcher-"));
    try {
        const ptb = CHANNELS.find((channel) => channel.name === "ptb");
        const core = path.join(home, "Library", "Application Support", "discordptb", "app-0.0.271", "modules", "discord_desktop_core-1", "discord_desktop_core");
        fs.mkdirSync(core, { recursive: true });
        fs.writeFileSync(path.join(core, "index.js"), "module.exports = require('./core.asar');");
        fs.writeFileSync(path.join(core, "core.asar"), "");
        const folders = coreFolders(ptb, "darwin", {}, home);
        assert.deepEqual(folders, [core]);
        install(core);
        assert.equal(isInstalled(core), true);
        for (const file of ["switcher.js", "preload.js", "switcher.html"]) assert.ok(fs.statSync(path.join(core, "discord_oss_switcher", file)).size > 100);
        assert.match(fs.readFileSync(path.join(core, "discord_oss_switcher", "switcher.js"), "utf8"), /Switch instance/);
        uninstall(core);
        assert.equal(fs.readFileSync(path.join(core, "index.js"), "utf8"), "module.exports = require('./core.asar');");
        assert.equal(fs.existsSync(path.join(core, "discord_oss_switcher")), false);
        assert.deepEqual(coreFolders(CHANNELS[0], "darwin", {}, home), []);
    } finally {
        fs.rmSync(home, { recursive: true, force: true });
    }
});

test("the built switcher finds its files where it is installed", () => {
    const bundle = fs.readFileSync(path.join(__dirname, "..", "..", "apps", "official-desktop", "dist", "switcher.js"), "utf8");
    assert.match(bundle.split("\n")[0], /^var discordOssFolder = __dirname;/);
    assert.doesNotMatch(bundle, /\/Users\/|[A-Z]:\\\\|apps\/official-desktop\/src/);
});
