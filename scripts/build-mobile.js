const path = require("node:path");
const { transformAsync } = require("@babel/core");
const blockScoping = require("@babel/plugin-transform-block-scoping").default;
const parameters = require("@babel/plugin-transform-parameters").default;

const ROOT = path.join(__dirname, "..");
const OUTPUT = path.join(ROOT, "assets", "public", "mobile", "meowcord.js");
const E2EE_SOURCE = path.join(ROOT, "client", "e2ee", "src");
const MOBILE_E2EE = path.join(ROOT, "client", "mobile", "src", "e2ee");
const SHARED = "globalThis.__meowcordE2ee";

(async () => {
    const result = await Bun.build({
        entrypoints: [path.join(ROOT, "client", "mobile", "src", "index.ts")],
        root: ROOT,
        target: "browser",
        format: "iife",
        minify: true,
        sourcemap: "none",
        define: {
            crypto: `${SHARED}.crypto`,
            "globalThis.crypto": `${SHARED}.crypto`,
            document: `${SHARED}.document`,
            navigator: `${SHARED}.navigator`,
            addEventListener: `${SHARED}.addEventListener`,
            TextEncoder: `${SHARED}.TextEncoder`,
            TextDecoder: `${SHARED}.TextDecoder`,
            atob: `${SHARED}.atob`,
            btoa: `${SHARED}.btoa`,
        },
        plugins: [
            {
                name: "mobile-platform",
                setup: (build) => {
                    build.onResolve({ filter: /^\.\/store$/ }, ({ importer }) =>
                        path.dirname(importer) === E2EE_SOURCE ? { path: path.join(MOBILE_E2EE, "store.ts") } : undefined,
                    );
                    build.onResolve({ filter: /^hash-wasm$/ }, () => ({ path: path.join(MOBILE_E2EE, "argon2.ts") }));
                    build.onResolve({ filter: /^(node:)?crypto$/ }, () => ({ path: "crypto", namespace: "no-node-crypto" }));
                    build.onLoad({ filter: /.*/, namespace: "no-node-crypto" }, () => ({ contents: "export const webcrypto = undefined;", loader: "js" }));
                },
            },
        ],
    });
    if (!result.success) {
        for (const log of result.logs) console.error(log);
        process.exit(1);
    }
    const [output] = result.outputs;
    const options = { babelrc: false, configFile: false, compact: true, comments: false, sourceType: "script" };
    const simpleParameters = await transformAsync(await output.text(), { ...options, plugins: [parameters] });
    const lowered = await transformAsync(simpleParameters.code, { ...options, plugins: [[blockScoping, { throwIfClosureRequired: false, tdz: false }]] });
    const code = lowered.code;
    await transformAsync(code, {
        babelrc: false,
        configFile: false,
        code: false,
        sourceType: "script",
        plugins: [
            () => ({
                visitor: {
                    VariableDeclaration: (declaration) => {
                        if (declaration.node.kind !== "var") throw new Error(`a ${declaration.node.kind} declaration survived the Hermes transform`);
                    },
                    ArrowFunctionExpression: (arrow) => {
                        if (arrow.node.async && arrow.node.params.some((param) => param.type !== "Identifier"))
                            throw new Error("an async arrow function kept a non-simple parameter list");
                    },
                },
            }),
        ],
    });
    if (!code.includes('"__MEOWCORD_ENDPOINTS__"')) throw new Error("the endpoints placeholder did not survive the build");
    for (const name of ["indexedDB", "serviceWorker", "WebAssembly", "import("])
        if (code.includes(name)) throw new Error(`the mobile bundle still uses ${name}, which the app doesn't have`);
    await Bun.write(OUTPUT, code);
    console.log(`[mobile] wrote ${path.relative(ROOT, OUTPUT)} (${code.length} bytes)`);
})();
