const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "client", "vencord.json"), "utf8"));
const PLUGINS = path.join(ROOT, "client", "plugins");
const SOURCE_PATCHES = path.join(ROOT, "client", CONFIG.patches ?? "vencord-patches");
const CACHE = path.resolve(process.env.VENCORD_DIR || path.join(ROOT, ".vencord"));
const SOURCE = path.join(CACHE, "src");
const OUTPUT = path.resolve(process.env.VENCORD_OUTPUT || path.join(ROOT, "assets", "vencord"));
const reporter = process.argv.includes("--reporter");
const typecheck = process.argv.includes("--typecheck");

const run = (command, args, options = {}) => {
    const result = spawnSync(command, args, { cwd: SOURCE, stdio: "inherit", ...options });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
};

const succeeds = (command, args) => spawnSync(command, args, { cwd: SOURCE, stdio: "ignore" }).status === 0;

const checkout = () => {
    fs.mkdirSync(SOURCE, { recursive: true });
    if (!fs.existsSync(path.join(SOURCE, ".git"))) {
        run("git", ["init", "-q"]);
        run("git", ["remote", "add", "origin", CONFIG.repository]);
    }
    run("git", ["remote", "set-url", "origin", CONFIG.repository]);
    if (!succeeds("git", ["cat-file", "-e", `${CONFIG.commit}^{commit}`])) {
        console.log(`[equicord] fetching ${CONFIG.commit}`);
        run("git", ["fetch", "-q", "--depth", "1", "origin", CONFIG.commit]);
    }
    run("git", ["checkout", "-q", "--force", CONFIG.commit]);
    if (!fs.existsSync(SOURCE_PATCHES)) return;
    for (const patch of fs
        .readdirSync(SOURCE_PATCHES)
        .filter((x) => x.endsWith(".patch"))
        .sort()) {
        console.log(`[equicord] applying ${patch}`);
        run("git", ["apply", "--whitespace=nowarn", path.join(SOURCE_PATCHES, patch)]);
    }
};

const pnpm = () => {
    const pinned = JSON.parse(fs.readFileSync(path.join(SOURCE, "package.json"), "utf8")).packageManager?.match(/^pnpm@([^+]+)/)?.[1];
    if (!pinned) throw new Error("Equicord does not declare a pinned pnpm version");
    const matches = (candidate) =>
        spawnSync(candidate[0], [...candidate.slice(1), "--version"], {
            cwd: SOURCE,
            encoding: "utf8",
            env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" },
        }).stdout?.trim() === pinned;
    for (const candidate of [["pnpm"], ["corepack", "pnpm"]]) {
        if (matches(candidate)) return candidate;
    }
    const tools = path.join(CACHE, "tools");
    const packageFile = path.join(tools, "node_modules", "pnpm", "package.json");
    const executable = () => {
        if (!fs.existsSync(packageFile)) return null;
        const launcher = path.join(tools, "node_modules", "pnpm", "bin", "pnpm.mjs");
        if (fs.existsSync(launcher)) return launcher;
        const metadata = JSON.parse(fs.readFileSync(packageFile, "utf8"));
        const bin = typeof metadata.bin === "string" ? metadata.bin : metadata.bin?.pnpm;
        if (!bin || !/\.[cm]?js$/.test(bin) || path.isAbsolute(bin) || bin.split(/[\\/]/).includes("..")) throw new Error("Invalid pnpm executable path");
        return path.join(path.dirname(packageFile), bin);
    };
    if (!executable() || !matches(["node", executable()])) {
        fs.mkdirSync(tools, { recursive: true });
        fs.writeFileSync(path.join(tools, "package.json"), `${JSON.stringify({ name: "meowcord-equicord-tools", private: true })}\n`);
        run("bun", ["add", "--cwd", tools, `pnpm@${pinned}`]);
    }
    if (!executable() || !matches(["node", executable()])) throw new Error(`could not bootstrap pinned pnpm ${pinned}`);
    return ["node", executable()];
};

const install = (pm) => {
    const lockfile = fs.readFileSync(path.join(SOURCE, "pnpm-lock.yaml"));
    const stamp = path.join(CACHE, "install.stamp");
    const hash = crypto.createHash("sha256").update(lockfile).digest("hex");
    if (fs.existsSync(path.join(SOURCE, "node_modules")) && fs.existsSync(stamp) && fs.readFileSync(stamp, "utf8") === hash) return;
    console.log("[equicord] installing dependencies");
    run(pm[0], [...pm.slice(1), "install", "--frozen-lockfile"], {
        env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" },
    });
    fs.writeFileSync(stamp, hash);
};

const copyPlugins = () => {
    for (const name of CONFIG.pluginDependencies ?? []) {
        const dependency = path.join(ROOT, "node_modules", name);
        if (!fs.existsSync(path.join(dependency, "package.json"))) throw new Error(`missing plugin dependency ${name}, run bun install`);
        const destination = path.join(SOURCE, "node_modules", name);
        fs.rmSync(destination, { recursive: true, force: true });
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.symlinkSync(dependency, destination, "dir");
    }
    const target = path.join(SOURCE, "src", "userplugins");
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(target, { recursive: true });
    if (!fs.existsSync(PLUGINS)) return [];
    const names = fs
        .readdirSync(PLUGINS)
        .filter((x) => !x.startsWith("."))
        .sort();
    for (const name of names) fs.cpSync(path.join(PLUGINS, name), path.join(target, name), { recursive: true });
    return names;
};

const settingsKey = CONFIG.settingsKey ?? "VencordSettings";

const seedDefaults = (defaults) => `(() => {
    const defaults = ${JSON.stringify(defaults)};
    try {
        const legacy = ${JSON.stringify(settingsKey)} !== "VencordSettings" ? localStorage.getItem("VencordSettings") : null;
        const settings = JSON.parse(localStorage.getItem(${JSON.stringify(settingsKey)}) || legacy || "{}");
        const seeded = new Set(JSON.parse(localStorage.getItem("FosscordVencordSeeded") || "[]"));
        settings.plugins ??= {};
        for (const [name, value] of Object.entries(defaults.plugins)) {
            const key = typeof value === "boolean" ? name : \`\${name}:\${JSON.stringify(value)}\`;
            if (seeded.has(key)) continue;
            seeded.add(name).add(key);
            settings.plugins[name] = { ...settings.plugins[name], ...(typeof value === "boolean" ? { enabled: value } : value) };
        }
        if (typeof settings.plugins.SilentTyping?.isEnabled === "boolean")
            settings.plugins.SilentTyping.enabledGlobally ??= settings.plugins.SilentTyping.isEnabled;
        for (const [key, value] of Object.entries(defaults.settings)) settings[key] ??= value;
        localStorage.setItem(${JSON.stringify(settingsKey)}, JSON.stringify(settings));
        localStorage.setItem("FosscordVencordSeeded", JSON.stringify([...seeded]));
    } catch (e) {
        console.error("[equicord] could not seed default settings", e);
    }
})();
`;

const writeOutput = (version) => {
    const dist = fs.existsSync(path.join(SOURCE, "dist", "browser", "extension.js")) ? path.join(SOURCE, "dist", "browser") : path.join(SOURCE, "dist");
    const css = fs.readFileSync(path.join(dist, "extension.css"));
    const cssHash = crypto.createHash("sha256").update(css).digest("hex").slice(0, 12);
    const bundle = fs.readFileSync(path.join(dist, "extension.js"), "utf8").replace(/\n\/\/# sourceURL=[^\n]*\s*$/, "\n");
    const meta = `window.postMessage({ type: "vencord:meta", meta: { EXTENSION_VERSION: ${JSON.stringify(version)}, EXTENSION_BASE_URL: \`\${location.origin}/\`, RENDERER_CSS_URL: "/assets/vencord/vencord.css?v=${cssHash}" } }, "*");\n`;
    const script = `${seedDefaults({ plugins: CONFIG.plugins ?? {}, settings: CONFIG.settings ?? {} })}${bundle}${meta}//# sourceURL=file:///VencordWeb\n`;

    fs.mkdirSync(OUTPUT, { recursive: true });
    fs.writeFileSync(path.join(OUTPUT, reporter ? "reporter.js" : "vencord.js"), script);
    if (reporter) return;
    fs.writeFileSync(path.join(OUTPUT, "vencord.css"), css);
    fs.rmSync(path.join(OUTPUT, "vendor"), { recursive: true, force: true });
    fs.cpSync(path.join(dist, "vendor"), path.join(OUTPUT, "vendor"), { recursive: true });
};

(() => {
    const started = Date.now();
    checkout();
    const pm = pnpm();
    install(pm);
    const plugins = copyPlugins();
    if (typecheck) {
        console.log(`[equicord] typechecking with ${plugins.length} fosscord plugins`);
        run(pm[0], [...pm.slice(1), "testTsc"]);
        console.log(`[equicord] typecheck passed in ${Math.round((Date.now() - started) / 1000)}s`);
        return;
    }
    console.log(`[equicord] building ${reporter ? "reporter" : "web"} target with ${plugins.length} fosscord plugins`);
    run(pm[0], [...pm.slice(1), "buildWeb", "--skip-extension", ...(reporter ? ["--reporter"] : [])], {
        env: { ...process.env, VENCORD_HASH: CONFIG.commit.slice(0, 7) },
    });
    const { version } = JSON.parse(fs.readFileSync(path.join(SOURCE, "package.json"), "utf8"));
    writeOutput(version);
    fs.writeFileSync(
        path.join(OUTPUT, reporter ? "reporter.json" : "build.json"),
        JSON.stringify(
            {
                repository: CONFIG.repository,
                commit: CONFIG.commit,
                version,
                plugins,
                builtAt: new Date().toISOString(),
            },
            null,
            4,
        ),
    );
    console.log(`[equicord] wrote ${path.relative(ROOT, OUTPUT)} in ${Math.round((Date.now() - started) / 1000)}s`);
})();
