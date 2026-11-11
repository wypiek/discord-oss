const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const MISSING_ACCESS = Object.assign(new Error("Missing Access"), { code: 50001 });
const REACHED = new Error("passed the membership check");

function interactions(members) {
    let handler;
    const imports = {
        "node:crypto": require("node:crypto"),
        express: { Router: () => ({ post: (_, ...steps) => (handler = steps.at(-1)) }) },
        "lambert-server/HTTPError": { HTTPError: class extends Error {} },
        "@spacebar/schemas": {
            getAjv: () => ({}),
            InteractionType: { ApplicationCommand: 2, MessageComponent: 3, ApplicationCommandAutocomplete: 4, ModalSubmit: 5 },
            ApplicationCommandType: { PRIMARY_ENTRY_POINT: 4 },
            ApplicationCommandHandlerType: { DISCORD_LAUNCH_ACTIVITY: 2 },
            ChannelType: { DM: 1 },
            InteractionFailureReason: {},
        },
        "@spacebar/api/middlewares": { route: () => () => {} },
        "@spacebar/database": {
            Application: { findOne: async () => ({ id: "app", bot: { id: "app" } }) },
            ApplicationAuthorization: { exists: async () => false },
            ApplicationCommand: {},
            Channel: { findOne: async () => ({ id: "channel", guild_id: "guild", type: 0, recipients: [] }) },
            Guild: {},
            Member: { exists: async ({ where }) => where.guild_id === "guild" && [...members, "app"].includes(where.id) },
            Session: {},
        },
        "@spacebar/util": {
            Config: {},
            DiscordApiErrors: { MISSING_ACCESS, UNKNOWN_APPLICATION: new Error("unknown application"), UNKNOWN_CHANNEL: new Error("unknown channel") },
            FieldErrors: () => new Error("field"),
            emitEvent: async () => {},
            getPermission: async () => ({ hasThrow() {}, has: () => true, cache: {} }),
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
            fetchInteractionMessage: async () => {
                throw REACHED;
            },
            interactionTarget: () => ({}),
            processInteractionCallback: async () => {},
        },
        "@spacebar/api/activities": { launchActivity: async () => {} },
        "@spacebar/api/util/handlers/Application": {},
        "@spacebar/api/util": {},
        "@spacebar/api/util/handlers/ApplicationCommands": {},
        "@spacebar/api/util/handlers/ComponentValidation": {},
        "@spacebar/api/util/handlers/FieldCaps": { interactionRequestErrors: () => ({}) },
        "@spacebar/api/util/handlers/InteractionDelivery": { INTERACTION_RESPONSE_WINDOW_MS: 3000, deliverOverHttp: async () => {} },
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
            Buffer,
            require: (name) => {
                assert.ok(name in imports, `missing mock for ${name}`);
                return imports[name];
            },
        },
    );
    return (user_id) =>
        handler(
            {
                user_id,
                body: { type: 3, application_id: "app", channel_id: "channel", message_id: "message", nonce: "n", data: { component_type: 2, custom_id: "verify" } },
            },
            { sendStatus() {} },
        );
}

test("someone lurking a discoverable guild cannot press a bot's buttons", async () => {
    const press = interactions(["member"]);
    await assert.rejects(press("lurker"), (err) => err === MISSING_ACCESS);
    await assert.rejects(press("member"), (err) => err === REACHED);
});
