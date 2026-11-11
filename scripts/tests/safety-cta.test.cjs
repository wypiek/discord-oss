const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
function load(file, imports = {}) {
    const module = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync(file, "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText,
        {
            module,
            exports: module.exports,
            require: (name) => imports[name],
            URL,
        },
    );
    return module.exports;
}
const server = load("src/api/util/utility/safetyMessageText.ts");
const client = load("client/e2ee/src/safetyNoticeText.ts");
const fields = (entries) => Object.entries(entries).map(([name, value]) => ({ name, value }));
test("standing notification without a violation renders human text and a nonempty account-standing action", () => {
    const text = server
        .systemEmbedText({
            type: "safety_system_notification",
            fields: fields({
                icon_type: "danger",
                theme: "danger",
                header: "Your account is limited",
                body: "Review and appeal your violations.",
                timestamp: "1791135304",
                ctas: "",
            }),
        })
        .join("\n\n");
    assert.ok(text.includes("**Your account is limited**"));
    assert.ok(text.includes("[Review Account Standing]"));
    for (const label of ["icon_type", "theme", "timestamp", "ctas"]) assert.equal(text.includes(label), false);
    assert.equal(client.readableSafetyNotice(text), text);
});
test("existing encrypted field dump is repaired without modifying ordinary messages", () => {
    const raw =
        "**icon_type**\ndanger\n\n**theme**\ndanger\n\n**header**\nYour account is limited\n\n**body**\nReview and appeal violations.\n\n**timestamp**\n1791135304\n\n**ctas**\n";
    assert.ok(client.readableSafetyNotice(raw.trim()).includes("[Review Account Standing]"));
    const text = client.readableSafetyNotice(raw);
    assert.ok(text.includes("[Review Account Standing]"));
    assert.equal(text.includes("**ctas**"), false);
    for (const tail of [
        "policy_violation_detail\n\n**classification_id**\n123",
        "learn_more_link\n\n**classification_id**\n123\n\n**learn_more_link**\nhttps://help.example/policy",
    ]) {
        assert.ok(client.readableSafetyNotice(raw + tail).includes("Review Account Standing"));
    }
    assert.equal(client.readableSafetyNotice("An ordinary **header** message"), "An ordinary **header** message");
    assert.equal(client.readableSafetyNotice(raw + "unrecognized-fields"), raw + "unrecognized-fields");
});
test("policy notices get an actionable explanation; unsafe learn-more URLs are excluded", () => {
    for (const link of ["javascript:alert(1)", "https://name:secret@help.example/"]) {
        const text = server
            .systemEmbedText({
                type: "safety_policy_notice",
                fields: fields({ classification_id: "123", learn_more_link: link }),
            })
            .join("\n");
        assert.ok(text.includes("Account Standing"));
        assert.equal(text.includes(link), false);
        assert.equal(text.includes("[Learn more]"), false);
    }
    const text = server
        .systemEmbedText({
            type: "safety_system_notification",
            fields: fields({
                header: "Appeal reviewed",
                body: "A decision",
                learn_more_link: "https://help.example/policy",
            }),
        })
        .join("\n");
    assert.ok(text.includes("[Learn more](https://help.example/policy)"));
    const rich = server
        .systemEmbedText({
            type: "rich",
            title: "Normal title",
            description: "Normal body",
            fields: fields({ Reason: "A reason" }),
        })
        .join("\n");
    assert.ok(rich.includes("**Reason**\nA reason"));
});
test("native CTA localizes only the exact standing link and opens native settings", () => {
    let clicked, observerCallback, navigated;
    const anchor = { href: client.SAFETY_STANDING_URL };
    class Element {
        closest() {
            return anchor;
        }
    }
    const document = {
        body: {},
        querySelectorAll: () => (anchor.href === client.SAFETY_STANDING_URL ? [anchor] : []),
        addEventListener: (name, handler) => (clicked = handler),
        removeEventListener: () => {},
    };
    class MutationObserver {
        constructor(callback) {
            observerCallback = callback;
        }
        observe() {}
        disconnect() {}
    }
    const module = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("client/plugins/fosscordSafetyCTAs/index.ts", "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText,
        {
            module,
            exports: module.exports,
            require: (name) =>
                name === "@utils/types"
                    ? { default: (value) => value, __esModule: true }
                    : name === "@webpack"
                      ? {
                            filters: { byCode: () => null },
                            mapMangledModuleLazy: () => ({ replaceWith: (path) => (navigated = path) }),
                        }
                      : { FosscordAuthor: {} },
            location: { origin: "https://remote.example:8443" },
            document,
            MutationObserver,
            Element,
        },
    );
    module.exports.default.start();
    assert.equal(anchor.href, "https://remote.example:8443/settings/account/account-standing");
    let prevented = false;
    clicked({
        target: new Element(),
        button: 0,
        preventDefault: () => (prevented = true),
        stopImmediatePropagation: () => {},
    });
    assert.equal(navigated, "/settings/account/account-standing");
    assert.equal(prevented, true);
    for (const href of ["https://evil.example/settings/account/account-standing", "https://meowcord.invalid/settings/account/account-standing?next=evil"]) {
        anchor.href = href;
        prevented = false;
        clicked({
            target: new Element(),
            button: 0,
            preventDefault: () => (prevented = true),
            stopImmediatePropagation: () => {},
        });
        assert.equal(prevented, false);
    }
    module.exports.default.stop();
});

test("automatic standing notice emits a supported CTA even without a linked violation", async () => {
    let sent;
    const api = load("src/api/util/utility/safetyNotices.ts", {
        "@spacebar/database": {},
        "@spacebar/util": {},
        "@spacebar/schemas": load("src/schemas/responses/AccountStandingResponse.ts"),
        "./accountStanding": {},
        "./safetyMessageText": server,
        "./systemAccounts": {
            sendSystemDM: async (sender, recipient, body) => {
                sent = body;
            },
        },
    });
    await api.notifyStandingDrop("2", 100, 200);
    const values = Object.fromEntries(sent.embeds[0].fields.map((field) => [field.name, field.value]));
    assert.equal(values.ctas, "learn_more_link");
    assert.equal(values.learn_more_link, client.SAFETY_STANDING_URL);
});
