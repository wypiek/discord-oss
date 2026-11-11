const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function entryPoint() {
    const events = [];
    const launches = [];
    const sessions = [
        { session_id: "mine", user_id: "caller" },
        { session_id: "theirs", user_id: "victim" },
    ];
    let handler;
    const imports = {
        "node:crypto": require("node:crypto"),
        express: { Router: () => ({ post: (_, ...steps) => (handler = steps.at(-1)) }) },
        "lambert-server/HTTPError": { HTTPError: class extends Error {} },
        "@spacebar/schemas": {
            getAjv: () => ({}),
            InteractionType: { ApplicationCommand: 2 },
            ApplicationCommandType: { PRIMARY_ENTRY_POINT: 4 },
            ApplicationCommandHandlerType: { DISCORD_LAUNCH_ACTIVITY: 2 },
            ChannelType: {},
            InteractionFailureReason: {},
        },
        "@spacebar/api/middlewares": { route: () => () => {} },
        "@spacebar/database": {
            Application: {},
            ApplicationAuthorization: {},
            ApplicationCommand: { findOne: async () => ({ application_id: "app" }) },
            Channel: {},
            Guild: {},
            Member: {},
            Session: { exists: async ({ where }) => sessions.some((s) => s.session_id === where.session_id && s.user_id === where.user_id) },
        },
        "@spacebar/util": {
            Config: {},
            DiscordApiErrors: {},
            FieldErrors: () => new Error("field"),
            emitEvent: async (event) => events.push(event),
            getPermission: async () => ({}),
            findInteraction: async () => undefined,
            trackBackground: (work) => work,
            Permissions: {},
            Snowflake: { generate: () => "interaction" },
            storeInteraction: async () => ({}),
        },
        "@spacebar/api/util/handlers/Interaction": {
            buildResolved: () => ({}),
            canReadInteractionMessage: () => true,
            emitInteractionFailure: async () => {},
            fetchInteractionMessage: async () => null,
            interactionTarget: (interaction) => (interaction.sessionId ? { session_id: interaction.sessionId } : { user_id: interaction.userId }),
            processInteractionCallback: async () => {},
        },
        "@spacebar/api/activities": { launchActivity: async (options) => launches.push(options) },
        "@spacebar/api/util/handlers/InteractionDelivery": { INTERACTION_RESPONSE_WINDOW_MS: 3000 },
        "@spacebar/api/util": {},
        "@spacebar/api/util/handlers/ApplicationCommands": {},
        "@spacebar/api/util/handlers/ComponentValidation": {},
        "@spacebar/api/util/handlers/FieldCaps": { interactionRequestErrors: () => ({}) },
    };
    const loaded = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("src/api/routes/interactions/index.ts", "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
        }).outputText,
        {
            module: loaded,
            exports: loaded.exports,
            console,
            require: (name) => {
                assert.ok(name in imports, `missing mock for ${name}`);
                return imports[name];
            },
        },
    );
    const launch = (session_id) =>
        handler({ user_id: "caller", body: { type: 2, application_id: "app", channel_id: "channel", session_id, nonce: "n", data: { id: "command" } } }, { sendStatus() {} });
    return { launch, events };
}

test("an entry point launch only sends its events to one of the caller's own sessions", async () => {
    const spoofed = entryPoint();
    await spoofed.launch("theirs");
    assert.ok(spoofed.events.length > 0);
    assert.ok(spoofed.events.every((event) => event.session_id === undefined && event.user_id === "caller"));

    const own = entryPoint();
    await own.launch("mine");
    assert.ok(own.events.every((event) => event.session_id === "mine"));
});
