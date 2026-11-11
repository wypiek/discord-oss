const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const vm = require("node:vm");

function load(file, common, globals = {}, exposed = "") {
    const module = { exports: {} };
    const source = ts.transpileModule(fs.readFileSync(file, "utf8") + exposed, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            esModuleInterop: true,
            jsx: ts.JsxEmit.ReactJSX,
        },
    }).outputText;
    vm.runInNewContext(source, {
        module,
        exports: module.exports,
        require(name) {
            if (name === "@utils/types") return { default: (value) => value, __esModule: true };
            if (name === "@webpack/common") return common;
            if (name === "@webpack") return { findComponentByCodeLazy: () => () => null };
            return { FosscordAuthor: {} };
        },
        ...globals,
    });
    return module.exports;
}

test("private send and edit preparation failures use Equicord's current toast API", async () => {
    for (const hook of ["onBeforeMessageSend", "onBeforeMessageEdit"]) {
        let clock = 0;
        const toasts = [];
        const { default: plugin } = load(
            "client/plugins/fosscordE2ee/index.tsx",
            {
                ChannelStore: { getChannel: () => ({ type: 1 }) },
                showToast: (...args) => toasts.push(args),
            },
            {
                window: {},
                location: { pathname: "/channels/@me/111" },
                Date: { now: () => clock },
                setTimeout: (callback, ms) => {
                    clock += ms;
                    queueMicrotask(callback);
                },
            },
        );
        assert.equal((await plugin[hook]("111")).cancel, true);
        assert.equal(clock, 20000);
        assert.deepEqual(toasts, [["Private chat is still preparing. Try sending again.", "failure"]]);
    }
});

test("private preparation guard preserves guild sends and the bridge cancellation decision", async () => {
    for (const scenario of [{ type: 0 }, { type: 1, cancelled: false }, { type: 3, cancelled: true }]) {
        const toasts = [];
        const window = scenario.type === 0 ? {} : { __fosscordE2ee: { beforeSend: async () => scenario.cancelled } };
        const { default: plugin } = load(
            "client/plugins/fosscordE2ee/index.tsx",
            {
                ChannelStore: { getChannel: () => ({ type: scenario.type }) },
                showToast: (...args) => toasts.push(args),
            },
            { window },
        );
        const result = await plugin.onBeforeMessageSend("111");
        assert.equal(result?.cancel, scenario.cancelled ? true : undefined);
        assert.deepEqual(toasts, []);
    }
});

test("role templates use current success and partial-permission toasts after dispatch", () => {
    for (const allowed of [3n, 1n, 0n]) {
        const events = [];
        const { apply } = load(
            "client/plugins/fosscordRoleTemplates/index.tsx",
            {
                PermissionsBits: { VIEW_CHANNEL: 1n, SEND_MESSAGES: 2n },
                PermissionStore: { can: (bit) => !!(allowed & bit) },
                FluxDispatcher: { dispatch: (event) => events.push({ ...event }) },
                showToast: (...args) => events.push(args),
            },
            {},
            "\nexports.apply = apply;",
        );
        apply({ name: "Member", permissions: ["VIEW_CHANNEL", "SEND_MESSAGES"] }, { id: "222", permissions: 0n }, { id: "111" });
        assert.deepEqual(events[0], {
            type: "GUILD_SETTINGS_ROLES_UPDATE_PERMISSION_SET",
            id: "222",
            permissions: allowed,
        });
        const skipped = allowed === 3n ? 0 : allowed === 1n ? 1 : 2;
        assert.deepEqual(events[1], [
            skipped ? `Applied Member, without ${skipped} permission${skipped === 1 ? "" : "s"} you don't have. Save to keep it.` : "Applied Member. Save to keep it.",
            skipped ? "message" : "success",
        ]);
        assert.equal(events.length, 2);
    }
});
