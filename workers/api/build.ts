import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { API_FALLBACK_PREFIXES } from "../cdn/src/media.ts";
import { CDN_FALLBACK_ROOTS } from "../router/src/index.ts";

const root = path.resolve(import.meta.dir, "../..");
const dist = path.join(root, "dist");
const out = path.join(import.meta.dir, "build");
const bundle = path.join(out, "bundle");

if (!existsSync(path.join(dist, "api", "Server.js"))) {
    console.error("dist/api/Server.js is missing, run `bun run build:src` in the repository root first");
    process.exit(1);
}

await Promise.all([rm(path.join(out, "dist"), { recursive: true, force: true }), rm(bundle, { recursive: true, force: true })]);

const skipped = new Set(["gateway", "webrtc"]);
const files = (await readdir(dist, { recursive: true })).filter((file) => file.endsWith(".js") && !file.endsWith(".test.js") && !skipped.has(file.split(path.sep)[0]));

await Promise.all(
    files.map(async (file) => {
        const source = (await readFile(path.join(dist, file), "utf8")).replaceAll(/require\.resolve\("([^"]+)"\)/g, (match, specifier: string) =>
            JSON.stringify(path.posix.join("/bundle", path.relative(root, Bun.resolveSync(specifier, root)).split(path.sep).join("/"))),
        );
        const target = path.join(out, "dist", file);
        await mkdir(path.dirname(target), { recursive: true });
        if (!/__dirname|__filename/.test(source)) return writeFile(target, source);
        const location = `var __dirname = ${JSON.stringify(path.posix.join("/bundle/dist", path.dirname(file)))}, __filename = ${JSON.stringify(path.posix.join("/bundle/dist", file))};`;
        const [first, ...rest] = source.split("\n");
        const patched = first.trim() === '"use strict";' ? [first, location, ...rest] : [location, first, ...rest];
        return writeFile(target, patched.join("\n"));
    }),
);

await cp(path.join(dist, "tsconfig.json"), path.join(out, "dist", "tsconfig.json"));
await mkdir(path.join(bundle, "assets"), { recursive: true });
await cp(path.join(root, "assets", "locales"), path.join(bundle, "assets", "locales"), { recursive: true });
await cp(path.join(root, "assets", "activities"), path.join(bundle, "assets", "activities"), { recursive: true });
await mkdir(path.join(bundle, "assets", "public"), { recursive: true });
const groupAvatars = (await readdir(path.join(root, "assets", "public"))).filter((file) => /^[0-9a-f]{32}\.png$/.test(file)).map((file) => `public/${file}`);
for (const asset of ["icon.png", "icon_white.png", "logo.png", "public/index.html", "public/legal.html", "public/widget.html", ...groupAvatars])
    await cp(path.join(root, "assets", asset), path.join(bundle, "assets", asset));
await cp(path.join(dist, "default-avatars"), path.join(bundle, "dist", "default-avatars"), { recursive: true });
for (const font of ["open-sans-8-white", "open-sans-16-white", "open-sans-32-white"])
    await cp(path.join(path.dirname(Bun.resolveSync("@jimp/plugin-print/package.json", root)), "fonts", "open-sans", font), path.join(bundle, "jimp-fonts", font), {
        recursive: true,
    });
await cp(path.join(root, "package.json"), path.join(bundle, "package.json"));
const revision = (args: string[]) =>
    Bun.spawnSync(["git", "-C", root, ...args])
        .stdout.toString()
        .trim();
await writeFile(
    path.join(bundle, ".rev"),
    JSON.stringify({ rev: revision(["rev-parse", "HEAD"]) || null, lastModified: Number(revision(["log", "-1", "--format=%cd", "--date=unix"])) || 0 }),
);

const { traverseDirectory } = await import(path.join(dist, "util", "util", "lambert-server", "Utils.js"));
const trees: [string, string, (relative: string) => boolean][] = [
    ["routes", "api/routes", () => true],
    ["routes_toplevel", "api/routes_toplevel", () => true],
    [
        "cdn",
        "cdn/routes",
        (relative) => {
            const root = relative.split("/")[0].replace(/\.js$/, "");
            return (CDN_FALLBACK_ROOTS.has(root) && root !== "federation-upload") || API_FALLBACK_PREFIXES.has(root);
        },
    ],
];
const manifest = await Promise.all(
    trees.map(async ([name, folder, keep]) => {
        const directory = path.join(out, "dist", folder, "/");
        const routes: string[] = await traverseDirectory({ dirname: directory, recursive: true, filter: /^([^.].*)(?<!\.d)\.js$/ }, (file: string) => file);
        const entries = routes
            .map((file) => path.relative(directory, file).split(path.sep).join("/"))
            .filter(keep)
            .map((relative) => `[${JSON.stringify(relative)}, require(${JSON.stringify(`./dist/${folder}/${relative}`)})]`);
        return `    ${JSON.stringify(name)}: [\n        ${entries.join(",\n        ")}\n    ]`;
    }),
);
const connections = (await readdir(path.join(out, "dist", "connections"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && existsSync(path.join(out, "dist", "connections", entry.name, "index.js")))
    .map((entry) => entry.name)
    .sort();
const connectionList = connections.map((name) => `require(${JSON.stringify(`./dist/connections/${name}/index.js`)})`).join(",\n        ");
await writeFile(path.join(out, "routes.js"), `module.exports = {\n${manifest.join(",\n")}\n};\nmodule.exports.connections = [\n        ${connectionList}\n];\n`);

const schemaSource = await readFile(path.join(root, "assets", "schemas.json"), "utf8");
const schemaHash = createHash("sha256").update(schemaSource).digest("hex");
const validatorsFile = path.join(out, "validators.js");
const hashFile = path.join(out, "validators.sha256");
const cached = existsSync(validatorsFile) && existsSync(hashFile) && (await readFile(hashFile, "utf8")) === schemaHash;

if (!cached) {
    const { default: Ajv, _ } = await import("ajv");
    const { default: standaloneCode } = await import("ajv/dist/standalone");
    const { default: addFormats } = await import("ajv-formats");
    const schemas = JSON.parse(schemaSource.replaceAll("#/definitions/", ""));
    const createAjv = () => {
        const ajv = new Ajv({
            allErrors: true,
            parseDate: true,
            allowDate: true,
            coerceTypes: true,
            messages: true,
            strict: true,
            strictRequired: true,
            allowUnionTypes: true,
            code: { source: true, formats: _`require("ajv-formats/dist/formats").fullFormats` },
        });
        addFormats(ajv);
        for (const [name, schema] of Object.entries(schemas)) ajv.addSchema(schema as object, name);
        return ajv;
    };
    let probe = createAjv();
    const compilable = Object.keys(schemas).filter((name) => {
        try {
            return !!probe.getSchema(name);
        } catch (error) {
            console.warn(`skipping schema ${name}: ${(error as Error).message}`);
            probe = createAjv();
            return false;
        }
    });
    await writeFile(validatorsFile, standaloneCode(createAjv(), Object.fromEntries(compilable.map((name) => [name, name]))));
    await writeFile(hashFile, schemaHash);
    console.log(`compiled ${compilable.length} of ${Object.keys(schemas).length} schemas`);
}

console.log(`staged ${files.length} files from dist and ${manifest.length} route trees`);
