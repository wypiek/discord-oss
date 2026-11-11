const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const { execFileSync } = require("node:child_process");
const baselineRef = "c302ca43e730c7c671107f4f16453f661b5979d6";
const { Readable, Writable } = require("node:stream");
const { once } = require("node:events");
const load = (file, imports, globals = {}) => {
    const module = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(
            file.includes("ActivityHost.ts") || file.includes("handlers/Application.ts")
                ? execFileSync("git", ["show", `${baselineRef}:${file}`], { encoding: "utf8" })
                : fs.readFileSync(file, "utf8"),
            { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
        ).outputText,
        {
            module,
            exports: module.exports,
            require: (name) => {
                assert.ok(name in imports, name);
                return imports[name];
            },
            URL,
            Headers,
            Response,
            Buffer,
            AbortSignal,
            AbortController,
            setTimeout,
            clearTimeout,
            console: { error: () => {} },
            ...globals,
        },
    );
    return module.exports;
};

(async () => {
    const config = {
        security: { allowPrivateNetworkRequests: false },
        externalRequests: { thirdParty: false },
        client: { activityApplicationHost: null },
    };
    let dnsCount = 0;
    const dnsLookup = async () => [{ address: ++dnsCount === 1 ? "93.184.216.34" : "127.0.0.1", family: 4 }];
    const publicNetwork = load("src/util/util/networking/PublicNetwork.ts", {
        "node:dns/promises": { lookup: dnsLookup },
        "node:net": require("node:net"),
        "node:http": require("node:http"),
        "node:https": require("node:https"),
        "../Config": { Config: { get: () => config } },
    });
    let interactionTransport;
    const application = load(
        "src/api/util/handlers/Application.ts",
        {
            "node:crypto": {},
            typeorm: {},
            "@spacebar/database": {},
            "./ApplicationCommands": {},
            "@spacebar/util": { isPublicUrl: publicNetwork.isPublicUrl },
        },
        {
            fetch: async (url, init) => {
                const [resolved] = await dnsLookup(new URL(url).hostname);
                interactionTransport = { resolved, init };
                return new Response(JSON.stringify({ large: "x".repeat(6 * 1024 * 1024) }));
            },
        },
    );
    const result = await application.postSignedInteraction("https://app.invalid/callback", "unused", { type: 1 }, "synthetic-signature");
    const interactionJson = await result.json();
    assert.equal(interactionTransport.resolved.address, "127.0.0.1");
    assert.equal(interactionTransport.init.redirect, "error");
    assert.ok(interactionTransport.init.signal);
    assert.ok(interactionJson.large.length > 5 * 1024 * 1024);

    let activityTransport;
    const host = load(
        "src/api/activities/ActivityHost.ts",
        {
            "node:stream": require("node:stream"),
            "node:stream/promises": require("node:stream/promises"),
            "@spacebar/database": {
                EmbeddedActivity: {
                    findOne: async () => ({
                        application: { flags: 1 << 17 },
                        url_mappings: [{ prefix: "/", target: "https://app.invalid" }],
                    }),
                },
            },
            "@spacebar/util": { Config: { get: () => config }, isPublicUrl: async () => true },
            "./index": { APPLICATION_EMBEDDED: 1 << 17, BUILTIN_ACTIVITIES: {} },
        },
        {
            fetch: async (_url, init) => {
                activityTransport = init;
                return new Response("synthetic", { status: 200 });
            },
        },
    );
    const req = Readable.from([]);
    req.headers = {
        host: "123456789012345678.unconfigured.invalid",
        authorization: "synthetic",
        cookie: "synthetic",
    };
    req.url = "/asset";
    req.method = "GET";
    req.protocol = "http";
    const res = new Writable({
        write(_chunk, _encoding, callback) {
            callback();
        },
    });
    res.status = () => res;
    res.set = () => res;
    res.type = () => res;
    res.setHeader = () => {};
    res.send = (value) => {
        res.end(value);
        return res;
    };
    res.locals = {};
    const completed = once(res, "finish");
    host.ActivityHost(req, res, () => {
        throw new Error("Unexpected next");
    });
    await completed;
    assert.ok(activityTransport);
    assert.equal(activityTransport.signal, undefined);
    assert.equal(activityTransport.headers.get("authorization"), "synthetic");
    assert.equal(activityTransport.headers.get("cookie"), "synthetic");
    process.stdout.write(
        JSON.stringify({
            syntheticOnly: true,
            realNetworkRequests: 0,
            externalPolicyDisabled: true,
            interactionSecondDnsPrivate: true,
            interactionLargeJsonAccepted: true,
            interactionRedirectsRejected: true,
            interactionTransportSignalPresent: true,
            activityUnconfiguredHostAccepted: true,
            activityExternalTransportInvoked: true,
            activityDeadlineAbsent: true,
            activityCallerCredentialsForwarded: true,
        }) + "\n",
    );
})().catch(() => {
    process.stderr.write("Synthetic outbound audit failed\n");
    process.exitCode = 1;
});
