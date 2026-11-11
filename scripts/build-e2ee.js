const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SOURCE = path.join(ROOT, "client", "e2ee", "src");
const OUTPUT = path.join(ROOT, "assets", "public", "e2ee");

(async () => {
    for (const [entry, name] of [
        ["index.ts", "e2ee.js"],
        ["sw.ts", "sw.js"],
    ]) {
        const result = await Bun.build({
            entrypoints: [path.join(SOURCE, entry)],
            root: ROOT,
            target: "browser",
            format: "iife",
            sourcemap: "none",
            plugins: [
                {
                    name: "node-crypto",
                    setup: (build) =>
                        build.onResolve({ filter: /^(node:)?crypto$/ }, ({ path }) => ({
                            path,
                            external: true,
                        })),
                },
            ],
        });
        if (!result.success) {
            for (const log of result.logs) console.error(log);
            process.exit(1);
        }
        const [output] = result.outputs;
        await Bun.write(path.join(OUTPUT, name), `"use strict";\n${await output.text()}`);
        console.log(`[e2ee] wrote ${path.relative(ROOT, path.join(OUTPUT, name))} (${output.size} bytes)`);
    }
})();
