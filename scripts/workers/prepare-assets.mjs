import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { BRANDED_CLIENT_ASSETS } from "../../src/util/util/BrandMarkup.ts";
import { baseGlobalEnv, clientRootsFromEntry, GLOBAL_ENV_SCRIPT, prepareClientHtml } from "../../src/bundle/ClientHtml.ts";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const ASSETS = path.join(ROOT, "assets");
const CACHE = path.resolve(process.env.CLIENT_CACHE_PATH || path.join(ASSETS, "cache"));
const VENCORD = path.resolve(process.env.VENCORD_PATH || path.join(ASSETS, "vencord"));
const OUT = path.resolve(process.env.WORKERS_ASSETS_OUT || path.join(ROOT, "workers", "router", ".deploy", "public"));
const MAX_FILE = 25 * 1024 * 1024;
const FREE_PLAN_FILES = 20_000;
const PAID_PLAN_FILES = 100_000;
const HASHED = /(?:^|[.-])[0-9a-f]{8,32}\.\w+$/;
const PAGES = {
    admin: "admin/index.html",
    status: "status/index.html",
    developers: "developers/index.html",
    appeal: "appeal/index.html",
    verify: "verify.html",
    "not-found": "not-found.html",
};

if (!OUT.split(path.sep).includes(".deploy")) throw new Error(`refusing to clear ${OUT}, the output directory must be inside a .deploy directory`);
if (!fs.existsSync(path.join(CACHE, "index.html"))) throw new Error(`${CACHE}/index.html is missing, run \`bun run generate:client\` or set CLIENT_CACHE_PATH`);

require("../client-release.js").check(CACHE);

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const published = new Set();
const stats = { linked: 0, copied: 0, skipped: [] };

const place = (source, target) => {
    if (published.has(target)) return;
    const size = fs.statSync(source).size;
    if (size > MAX_FILE) {
        stats.skipped.push(`${target} (${size} bytes, over the 25 MiB asset limit)`);
        return;
    }
    const destination = path.join(OUT, target);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    try {
        fs.linkSync(source, destination);
        stats.linked++;
    } catch (error) {
        if (error.code !== "EXDEV") throw error;
        fs.copyFileSync(source, destination);
        stats.copied++;
    }
    published.add(target);
};

const placeTree = (source, target, keep = () => true) => {
    if (!fs.existsSync(source)) return;
    for (const entry of fs.readdirSync(source, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const from = path.join(source, entry.name);
        const to = path.posix.join(target, entry.name);
        if (entry.isDirectory()) placeTree(from, to, keep);
        else if (entry.isFile() && keep(entry.name, from)) place(from, to);
    }
};

const isTemplate = (name) => name.endsWith(".html");

placeTree(path.join(ASSETS, "public"), "assets", (name) => !isTemplate(name));
placeTree(path.join(ASSETS, "public", "admin"), "admin", (name) => !isTemplate(name));
placeTree(path.join(ASSETS, "public", "developers"), "developers", (name) => !isTemplate(name));
place(path.join(ASSETS, "public", "e2ee", "sw.js"), "e2ee-sw.js");
place(path.join(ASSETS, "public", "notifications", "sw.js"), "notifications-sw.js");

const vencordScript = path.join(VENCORD, "vencord.js");
const vencordHash = fs.existsSync(vencordScript) ? createHash("sha256").update(fs.readFileSync(vencordScript)).digest("hex").slice(0, 12) : null;
if (!vencordHash) console.warn(`[prepare-assets] ${vencordScript} is missing, the client will load without Equicord. Run \`bun run build:equicord\``);
for (const name of ["vencord.js", "vencord.css"]) if (fs.existsSync(path.join(VENCORD, name))) place(path.join(VENCORD, name), `assets/vencord/${name}`);
placeTree(path.join(VENCORD, "vendor"), "assets/vencord/vendor");
placeTree(path.join(VENCORD, "vendor", "monaco"), "vendor/monaco");

const manifest = JSON.parse(fs.readFileSync(path.join(CACHE, "release-manifest.json"), "utf8"));
const reviewed = new Set(manifest.assets);
const workerOwned = new Set([...Object.keys(BRANDED_CLIENT_ASSETS), "favicon.ico", "favicon.svg"]);
let unreviewed = 0;
for (const name of fs.readdirSync(CACHE).sort()) {
    if (!/^[\w.-]+$/.test(name) || workerOwned.has(name) || name.endsWith(".map")) continue;
    if (["index.html", "release-manifest.json", "clan-badges.json"].includes(name)) continue;
    if (/\.(?:js|css|wasm)$/.test(name) && !reviewed.has(name)) {
        unreviewed++;
        continue;
    }
    const source = path.join(CACHE, name);
    if (fs.statSync(source).isFile()) place(source, `assets/${name}`);
}

const source = fs.readFileSync(path.join(CACHE, "index.html"), "utf8");
const envMatch = source.match(GLOBAL_ENV_SCRIPT);
if (!envMatch) throw new Error("index.html has no GLOBAL_ENV");
const sandbox = { window: {} };
vm.runInNewContext(`window.GLOBAL_ENV =${envMatch[1]}`, sandbox);
const entry = source.match(/src="\/assets\/(web\.[0-9a-f]+\.js)"/)?.[1];
const roots = entry ? clientRootsFromEntry(fs.readFileSync(path.join(CACHE, entry), "utf8")) : null;
const patchFolder = path.join(ASSETS, "client_patches");
const patches = fs
    .readdirSync(patchFolder)
    .filter((name) => name.endsWith(".js"))
    .sort()
    .map((name) => `<script>${fs.readFileSync(path.join(patchFolder, name), "utf8")}</script>`)
    .join("\n");

const hidden = path.join(OUT, "_meowcord");
fs.mkdirSync(path.join(hidden, "pages"), { recursive: true });
fs.writeFileSync(
    path.join(hidden, "client.json"),
    JSON.stringify({
        html: prepareClientHtml(source),
        base: baseGlobalEnv(sandbox.window.GLOBAL_ENV ?? {}),
        patches,
        vencordHash,
        roots: roots ? [...roots] : null,
        versionHash: source.match(/"VERSION_HASH":"(\w+)"/)?.[1] ?? null,
        reviewed: [...reviewed].filter((name) => /\.(?:js|css|wasm)$/.test(name)).length,
    }),
);
for (const [name, file] of Object.entries(PAGES)) fs.copyFileSync(path.join(ASSETS, "public", file), path.join(hidden, "pages", `${name}.html`));
fs.copyFileSync(path.join(ASSETS, "icon.png"), path.join(hidden, "icon.png"));
placeTree(path.join(ASSETS, "badge-icons"), "_meowcord/badge-icons");
const capWidget = path.dirname(require.resolve("@cap.js/widget"));
const capWasm = path.resolve(path.dirname(require.resolve("@cap.js/wasm")), "../browser");
for (const [name, file] of Object.entries({
    "widget.js": path.join(capWidget, "cap.min.js"),
    "wasm-hashes.min.js": path.join(capWidget, "wasm-hashes.min.js"),
    "cap_wasm_bg.wasm": path.join(capWasm, "cap_wasm_bg.wasm"),
    "hashwx.wasm": path.join(capWasm, "hashwx.wasm"),
    "pako.js": path.resolve(path.dirname(require.resolve("pako")), "dist/pako_inflate.min.js"),
}))
    place(file, `_meowcord/cap/${name}`);
for (const name of ["openapi.json", "schemas.json"]) place(path.join(ASSETS, name), `_meowcord/api/${name}`);

const mutable = [...published].filter((target) => target.startsWith("assets/") && !(HASHED.test(path.posix.basename(target)) && !target.startsWith("assets/vencord/")));
const mutableRoots = new Set(mutable.map((target) => (target.split("/").length > 2 ? `/${target.split("/").slice(0, 2).join("/")}/*` : `/${target}`)));
const headers = ["/assets/*", "  Access-Control-Allow-Origin: *", "  X-Content-Type-Options: nosniff"];
if (mutableRoots.size + 6 <= 100) {
    headers.push("  Cache-Control: public, max-age=31536000, immutable");
    for (const rule of [...mutableRoots].sort()) headers.push("", rule, "  ! Cache-Control", "  Cache-Control: no-cache");
} else console.warn(`[prepare-assets] ${mutableRoots.size} unhashed asset paths do not fit in the 100 _headers rules, every asset is revalidated`);
headers.push("", "/e2ee-sw.js", "  Cache-Control: no-cache", "  Service-Worker-Allowed: /", "", "/notifications-sw.js", "  Cache-Control: no-cache");
headers.push("", "/admin/*", "  Cache-Control: no-cache", "", "/developers/*", "  Cache-Control: no-cache", "", "/vendor/*", "  Cache-Control: no-cache");
fs.writeFileSync(path.join(OUT, "_headers"), `${headers.join("\n")}\n`);

const count = published.size + 2 + Object.keys(PAGES).length;
console.log(`[prepare-assets] wrote ${OUT}`);
console.log(`[prepare-assets] ${count} files: ${stats.linked} hardlinked, ${stats.copied} copied, ${unreviewed} unreviewed scripts left out, ${mutableRoots.size} no-cache rules`);
if (stats.skipped.length) console.warn(`[prepare-assets] left out:\n  ${stats.skipped.join("\n  ")}`);
if (count > PAID_PLAN_FILES) throw new Error(`${count} files is over the ${PAID_PLAN_FILES} file limit of a Worker version`);
if (count > FREE_PLAN_FILES) console.warn(`[prepare-assets] ${count} files is over the Workers Free limit of ${FREE_PLAN_FILES}, deploying needs Workers Paid`);
