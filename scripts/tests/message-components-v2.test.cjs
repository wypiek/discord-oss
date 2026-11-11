const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { componentMessageErrors, findMessageComponent, messageComponentErrors, messageComponentText } = require("../../src/api/util/handlers/ComponentValidation.ts");
const valid = (components, flags = 32768) => assert.deepEqual(messageComponentErrors(components, flags), {});
const invalid = (components, flags = 32768) => assert.ok(Object.keys(messageComponentErrors(components, flags)).length);
const text = (content = "hello") => ({ type: 10, content });
const button = (custom_id = "click") => ({ type: 2, style: 1, label: "Click", custom_id });
const row = (...components) => ({ type: 1, components });

test("official v2 container embeds support all message layout and content components", () => {
    valid([
        {
            type: 17,
            accent_color: null,
            spoiler: true,
            components: [
                text("# heading"),
                {
                    type: 9,
                    components: [text(), text(), text()],
                    accessory: { type: 11, media: { url: "https://example.invalid/a.png" } },
                },
                {
                    type: 12,
                    items: [{ media: { url: "attachment://photo.png" }, description: "Photo", spoiler: true }],
                },
                { type: 13, file: { url: "attachment://file.pdf" } },
                { type: 14, spacing: 2 },
                row(button()),
            ],
        },
    ]);
    valid([row(button())], 0);
    valid([row({ type: 3, custom_id: "select", options: [{ label: "One", value: "one" }], min_values: 0 })]);
    for (const type of [5, 6, 7, 8]) valid([row({ type, custom_id: `select-${type}`, min_values: 0, max_values: 25 })]);
});

test("component nesting, child counts and forty-component total are enforced", () => {
    invalid([text()], 0);
    invalid([row(text())]);
    invalid([{ type: 17, components: [{ type: 17, components: [text()] }] }]);
    invalid([{ type: 9, components: [text(), text(), text(), text()], accessory: button() }]);
    invalid([row(button(), { type: 5, custom_id: "select" })]);
    invalid([row({ type: 4, custom_id: "modal", style: 1, label: "Input" })]);
    valid(Array.from({ length: 40 }, () => text()));
    invalid(Array.from({ length: 41 }, () => text()));
    invalid([
        {
            type: 12,
            items: Array.from({ length: 11 }, () => ({ media: { url: "https://example.invalid/a" } })),
        },
    ]);
    invalid([{ type: 9, components: [text()], accessory: null }]);
});

test("identifiers, text bounds, button and select contracts reject ambiguous interactions", () => {
    invalid([row(button("duplicate")), { type: 9, components: [text()], accessory: button("duplicate") }]);
    invalid([text(), { ...text(), id: 2 }, { ...text(), id: 2 }]);
    invalid([{ ...text(), id: -1 }]);
    valid([
        { ...text(), id: 0 },
        { ...text(), id: 0xffffffff },
    ]);
    invalid([text("x".repeat(4001))]);
    invalid([row({ type: 2, style: 5, label: "Link", url: "javascript:alert(1)" })]);
    invalid([row({ type: 2, style: 6, sku_id: "1" })]);
    invalid([row({ type: 3, custom_id: "select", max_values: 2, options: [{ label: "One", value: "one" }] })]);
    invalid([
        row({
            type: 3,
            custom_id: "select",
            options: [
                { label: "One", value: "same" },
                { label: "Two", value: "same" },
            ],
        }),
    ]);
    invalid([{ type: 13, file: { url: "https://example.invalid/file.pdf" } }]);
});

test("v2 messages reject legacy fields and never remove the v2 flag", () => {
    for (const field of [{ content: "text" }, { embeds: [{ title: "embed" }] }, { poll: {} }, { sticker_ids: ["1"] }])
        assert.ok(Object.keys(componentMessageErrors({ flags: 32768, ...field })).length);
    assert.deepEqual(componentMessageErrors({ flags: 32768, content: null, embeds: [], sticker_ids: [] }), {});
    assert.ok(componentMessageErrors({ flags: 0 }, 32768).flags);
    assert.deepEqual(componentMessageErrors({}, 32768), {});
});

function loadFunction(name, globals = {}, file = "Message.ts") {
    const source = ts.createSourceFile(file, fs.readFileSync(path.join(__dirname, "../../src/api/util/handlers", file), "utf8"), ts.ScriptTarget.Latest, true);
    const declaration = source.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
    const module = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(declaration.getText(source), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText,
        {
            module,
            exports: module.exports,
            ...globals,
        },
    );
    return module.exports[name];
}

test("automatic IDs replace zero and reserve explicit IDs across accessories", () => {
    const assign = loadFunction("assignComponentIds");
    const components = [
        {
            type: 17,
            id: 2,
            components: [{ type: 9, id: 0, components: [{ ...text(), id: 0 }], accessory: { ...button(), id: 9 } }],
        },
    ];
    assign(components);
    assert.equal(components[0].id, 2);
    assert.equal(components[0].components[0].id, 1);
    assert.equal(components[0].components[0].components[0].id, 3);
    assert.equal(components[0].components[0].accessory.id, 9);
});

test("attachment-backed component media receives authoritative response metadata", () => {
    const resolve = loadFunction("resolveMessageComponentAttachments", {
        Attachment: class {
            toJSON() {
                return {
                    url: "https://local.invalid/attachments/file",
                    proxy_url: "https://local.invalid/attachments/file",
                };
            }
        },
        FieldErrors: (errors) => Error(JSON.stringify(errors)),
    });
    const components = [
        {
            type: 17,
            components: [{ type: 13, file: { url: "attachment://manual.pdf" }, name: "forged", size: 123 }],
        },
    ];
    resolve(components, [{ id: "42", filename: "manual.pdf", size: 7, content_type: "application/pdf" }]);
    assert.equal(components[0].components[0].name, "manual.pdf");
    assert.equal(components[0].components[0].size, 7);
    assert.equal(components[0].components[0].file.attachment_id, "42");
    assert.throws(() => resolve([{ type: 13, file: { url: "attachment://missing.pdf" } }], []), /COMPONENT_ATTACHMENT_NOT_FOUND/);
});

test("application webhooks preserve components without the opt in query", () => {
    const apply = loadFunction("applyWebhookComponents", { FieldErrors: (errors) => Error(JSON.stringify(errors)) }, "Webhook.ts");
    const application = { components: [row(button())] };
    apply({ application_id: "42" }, application, false);
    assert.equal(application.components.length, 1);
    const incoming = { components: [text()] };
    apply({}, incoming, false);
    assert.equal(incoming.components, undefined);
    const optedIn = { components: [{ type: 17, components: [text()] }] };
    apply({}, optedIn, true);
    assert.equal(optedIn.components.length, 1);
    assert.throws(() => apply({}, { components: [row(button())] }, true), /COMPONENT_INTERACTIVE_NOT_ALLOWED/);
});

test("component interactions find nested accessories and reject disabled or forged controls", () => {
    const components = [
        {
            type: 17,
            components: [{ type: 9, components: [text()], accessory: { ...button("nested"), id: 7 } }, row({ ...button("disabled"), disabled: true })],
        },
    ];
    assert.equal(findMessageComponent(components, "nested", 2).id, 7);
    assert.equal(findMessageComponent(components, "nested", 3), undefined);
    assert.equal(findMessageComponent(components, "disabled", 2), undefined);
    assert.equal(findMessageComponent(components, "forged", 2), undefined);
});

test("v2 mention parsing uses text displays while keeping message content empty", () => {
    const components = [
        {
            type: 17,
            components: [text("hello <@123>"), { type: 9, components: [text("<@&456> @everyone")], accessory: button("label") }],
        },
    ];
    assert.equal(messageComponentText(components), "hello <@123>\n<@&456> @everyone");
});
