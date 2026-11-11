const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const {
    PAYLOAD_JSON_MAX_LENGTH,
    clampEmbedText,
    commandLocalizationErrors,
    embedCharacterCount,
    interactionRequestErrors,
    messageSearchErrors,
    modalComponentErrors,
    readPayloadJson,
    scheduledMessageErrors,
    searchTabErrors,
} = require("../../src/api/util/handlers/FieldCaps.ts");

const x = (length) => "x".repeat(length);
const fields = (errors) => Object.keys(errors).sort();

test("embed character totals count title, description, footer, author and fields across every embed", () => {
    const embed = {
        title: x(10),
        description: x(20),
        url: x(2000),
        footer: { text: x(30), icon_url: x(500) },
        author: { name: x(40), icon_url: x(500) },
        fields: [
            { name: x(5), value: x(6) },
            { name: x(7), value: x(8) },
        ],
    };
    assert.equal(embedCharacterCount([embed]), 126);
    assert.equal(embedCharacterCount([embed, embed]), 252);
    assert.equal(embedCharacterCount([{ description: x(4096) }, { description: x(1904) }]), 6000);
    assert.equal(embedCharacterCount([{ description: x(4096) }, { description: x(1905) }]), 6001);
    assert.equal(embedCharacterCount([null, "text", { fields: [null, { name: 1 }] }]), 0);
    assert.equal(embedCharacterCount(undefined), 0);
});

test("the message handler rejects embeds whose combined text exceeds the configured total", () => {
    const source = fs.readFileSync(path.join(__dirname, "../../src/api/util/handlers/Message.ts"), "utf8");
    assert.match(source, /embedCharacterCount\(embeds\) > maxEmbedCharacters/);
    assert.match(source, /opts\.attachments\?\.length \?\? 0\) > maxAttachments/);
});

test("multipart payload_json is parsed only when it is a bounded JSON object", () => {
    assert.deepEqual(readPayloadJson({ payload_json: '{"content":"hi"}' }), { body: { content: "hi" } });
    assert.deepEqual(readPayloadJson({ content: "plain" }), { body: { content: "plain" } });
    assert.deepEqual(readPayloadJson(undefined), { body: undefined });
    assert.deepEqual(fields(readPayloadJson({ payload_json: `"${x(PAYLOAD_JSON_MAX_LENGTH)}"` }).errors), ["payload_json"]);
    assert.equal(readPayloadJson({ payload_json: `"${x(PAYLOAD_JSON_MAX_LENGTH)}"` }).errors.payload_json.code, "BASE_TYPE_MAX_LENGTH");
    assert.equal(readPayloadJson({ payload_json: "{not json" }).errors.payload_json.code, "BASE_TYPE_INVALID");
    assert.equal(readPayloadJson({ payload_json: "[1,2]" }).errors.payload_json.code, "BASE_TYPE_INVALID");
    assert.equal(readPayloadJson({ payload_json: "null" }).errors.payload_json.code, "BASE_TYPE_INVALID");
    assert.equal(readPayloadJson({ payload_json: { content: "x" } }).errors.payload_json.code, "BASE_TYPE_STRING");
    assert.deepEqual(fields(readPayloadJson({ payload_json: "{}" }, [{ originalname: "a.png" }, { originalname: x(1025) }]).errors), ["files[1].filename"]);
    assert.deepEqual(readPayloadJson({ payload_json: "{}" }, [{ originalname: x(1024) }]), { body: {} });
});

test("message search rejects oversized content, values and value lists", () => {
    assert.deepEqual(messageSearchErrors({ content: x(1024), limit: "25", include_nsfw: true }), {});
    assert.deepEqual(fields(messageSearchErrors({ content: x(1025) })), ["content"]);
    assert.deepEqual(fields(messageSearchErrors({ author_id: x(257) })), ["author_id"]);
    assert.deepEqual(fields(messageSearchErrors({ author_id: Array.from({ length: 101 }, () => "1") })), ["author_id"]);
    assert.deepEqual(messageSearchErrors({ author_id: Array.from({ length: 100 }, () => "1") }), {});
    assert.deepEqual(messageSearchErrors({ channel_id: Array.from({ length: 1000 }, () => "1") }), {});
    assert.deepEqual(fields(messageSearchErrors({ channel_id: Array.from({ length: 1001 }, () => "1") })), ["channel_id"]);
    assert.deepEqual(fields(messageSearchErrors({ channel_id: [x(65)] })), ["channel_id"]);
    assert.deepEqual(fields(messageSearchErrors({ has: ["image", x(257)] })), ["has"]);
    assert.deepEqual(searchTabErrors({ messages: {}, media: {} }), {});
    assert.deepEqual(fields(searchTabErrors({ [x(65)]: {} })), ["tabs"]);
});

test("interaction requests cap identifiers, option values, select values and modal submissions", () => {
    const valid = {
        type: 2,
        application_id: "1",
        channel_id: "2",
        nonce: x(25),
        session_id: x(32),
        data: {
            id: "3",
            name: "cmd",
            options: [{ type: 1, name: "sub", options: [{ type: 3, name: "text", value: x(6000) }] }],
        },
    };
    assert.deepEqual(interactionRequestErrors(valid), {});
    assert.deepEqual(fields(interactionRequestErrors({ ...valid, nonce: x(26) })), ["nonce"]);
    assert.deepEqual(fields(interactionRequestErrors({ ...valid, channel_id: x(65) })), ["channel_id"]);
    assert.deepEqual(fields(interactionRequestErrors({ ...valid, data: { options: [{ name: "a", value: x(6001) }] } })), ["data.options[0].value"]);
    assert.deepEqual(fields(interactionRequestErrors({ ...valid, data: { options: [{ name: x(33) }] } })), ["data.options[0].name"]);
    assert.deepEqual(fields(interactionRequestErrors({ ...valid, data: { options: Array.from({ length: 26 }, () => ({ name: "a" })) } })), ["data.options"]);
    const deep = { name: "a", options: [{ name: "b", options: [{ name: "c", options: [{ name: "d", options: [] }] }] }] };
    assert.deepEqual(fields(interactionRequestErrors({ ...valid, data: { options: [deep] } })), ["data.options[0].options[0].options[0].options"]);
    assert.deepEqual(fields(interactionRequestErrors({ type: 3, data: { custom_id: x(101), values: ["a"] } })), ["data.custom_id"]);
    assert.deepEqual(fields(interactionRequestErrors({ type: 3, data: { custom_id: "a", values: Array.from({ length: 26 }, () => "a") } })), ["data.values"]);
    assert.deepEqual(fields(interactionRequestErrors({ type: 3, data: { custom_id: "a", values: [x(101)] } })), ["data.values[0]"]);
    const submitted = (value) => ({ type: 5, data: { id: "4", custom_id: "modal", components: [{ type: 18, component: { type: 4, custom_id: "input", value } }] } });
    assert.deepEqual(interactionRequestErrors(submitted(x(4000))), {});
    assert.deepEqual(fields(interactionRequestErrors(submitted(x(4001)))), ["data.components[0].component[0].value"]);
    assert.deepEqual(fields(interactionRequestErrors({ type: 5, data: { components: Array.from({ length: 6 }, () => ({ type: 1, components: [] })) } })), ["data.components"]);
    assert.deepEqual(fields(interactionRequestErrors({ type: 2, data: { attachments: [{ id: "0", filename: x(1025) }] } })), ["data.attachments[0].filename"]);
});

test("modal callbacks cap labels, placeholders, values, options and component counts", () => {
    const input = (overrides = {}) => ({ type: 4, custom_id: "input", style: 1, label: "Name", ...overrides });
    const label = (component, overrides = {}) => ({ type: 18, label: "Question", description: "Help", component, ...overrides });
    assert.deepEqual(modalComponentErrors([{ type: 1, components: [input({ label: x(45), placeholder: x(100), value: x(4000) })] }]), {});
    assert.deepEqual(modalComponentErrors([label({ type: 3, custom_id: "pick", placeholder: x(150), options: [{ label: x(100), value: x(100), description: x(100) }] })]), {});
    assert.deepEqual(fields(modalComponentErrors([{ type: 1, components: [input({ label: x(46) })] }])), ["data.components[0].components[0].label"]);
    assert.deepEqual(fields(modalComponentErrors([{ type: 1, components: [input({ placeholder: x(101) })] }])), ["data.components[0].components[0].placeholder"]);
    assert.deepEqual(fields(modalComponentErrors([{ type: 1, components: [input({ value: x(4001) })] }])), ["data.components[0].components[0].value"]);
    assert.deepEqual(fields(modalComponentErrors([{ type: 1, components: [input({ custom_id: x(101) })] }])), ["data.components[0].components[0].custom_id"]);
    assert.deepEqual(fields(modalComponentErrors([label(input(), { label: x(46) })])), ["data.components[0].label"]);
    assert.deepEqual(fields(modalComponentErrors([label(input(), { description: x(101) })])), ["data.components[0].description"]);
    assert.deepEqual(fields(modalComponentErrors([{ type: 10, content: x(4001) }])), ["data.components[0].content"]);
    assert.deepEqual(fields(modalComponentErrors([label({ type: 3, custom_id: "pick", options: Array.from({ length: 26 }, () => ({ label: "a", value: "a" })) })])), [
        "data.components[0].component[0].options",
    ]);
    assert.deepEqual(fields(modalComponentErrors([label({ type: 3, custom_id: "pick", options: [{ label: "a", value: x(101) }] })])), [
        "data.components[0].component[0].options[0].value",
    ]);
    assert.deepEqual(fields(modalComponentErrors([label(input({ url: x(2049) }))])), ["data.components[0].component[0].url"]);
    assert.deepEqual(fields(modalComponentErrors(Array.from({ length: 6 }, () => label(input())))), ["data.components"]);
});

test("command localizations are bounded like the names and descriptions they translate", () => {
    const command = {
        name: "cmd",
        name_localizations: { de: x(32), "es-419": "b" },
        description_localizations: { fr: x(100) },
        options: [{ name: "opt", description_localizations: { fr: "d" }, choices: [{ name: "c", name_localizations: { de: x(100) } }] }],
    };
    assert.deepEqual(commandLocalizationErrors(command), {});
    assert.deepEqual(fields(commandLocalizationErrors({ name_localizations: { de: x(33) } })), ["name_localizations.de"]);
    assert.deepEqual(fields(commandLocalizationErrors({ name_localizations: { de: "" } })), ["name_localizations.de"]);
    assert.deepEqual(fields(commandLocalizationErrors({ description_localizations: { de: x(101) } })), ["description_localizations.de"]);
    assert.deepEqual(fields(commandLocalizationErrors({ name_localizations: { [x(17)]: "a" } })), ["name_localizations"]);
    assert.deepEqual(fields(commandLocalizationErrors({ options: [{ choices: [{ name_localizations: { de: x(101) } }] }] })), ["options.0.choices.0.name_localizations.de"]);
    assert.deepEqual(fields(commandLocalizationErrors({ options: [{ name_localizations: { de: x(33) } }] }, "2.")), ["2.options.0.name_localizations.de"]);
    const deep = { options: [{ options: [{ options: [{ options: [{ name: "too deep" }] }] }] }] };
    assert.deepEqual(fields(commandLocalizationErrors(deep)), ["options.0.options.0.options.0.options"]);
});

test("scheduled messages are capped before they are stored", () => {
    const payload = {
        content: x(4000),
        sticker_ids: ["1", "2", "3"],
        attachments: [{ filename: x(1024), uploaded_filename: "a/b", description: x(1024), title: x(256) }],
        allowed_mentions: { parse: ["users"], users: ["1"] },
        message_reference: { message_id: "1" },
        poll: { question: { text: x(300) }, answers: [{ poll_media: { text: x(55), emoji: { name: "🐱" } } }] },
    };
    assert.deepEqual(scheduledMessageErrors(payload), {});
    assert.deepEqual(fields(scheduledMessageErrors({ ...payload, content: x(4001) })), ["content"]);
    assert.deepEqual(fields(scheduledMessageErrors({ ...payload, sticker_ids: ["1", "2", "3", "4"] })), ["sticker_ids"]);
    assert.deepEqual(fields(scheduledMessageErrors({ ...payload, attachments: [{ filename: "a", description: x(1025) }] })), ["attachments[0].description"]);
    assert.deepEqual(fields(scheduledMessageErrors({ ...payload, poll: { question: { text: x(301) }, answers: [] } })), ["poll.question.text"]);
    assert.deepEqual(fields(scheduledMessageErrors({ ...payload, poll: { question: { text: "q" }, answers: [{ poll_media: { text: x(56) } }] } })), [
        "poll.answers[0].poll_media.text",
    ]);
    assert.deepEqual(
        fields(scheduledMessageErrors({ ...payload, poll: { question: { text: "q" }, answers: Array.from({ length: 11 }, () => ({ poll_media: { text: "a" } })) } })),
        ["poll.answers"],
    );
    assert.deepEqual(fields(scheduledMessageErrors({ ...payload, allowed_mentions: { users: Array.from({ length: 101 }, () => "1") } })), ["allowed_mentions.users"]);
    assert.deepEqual(fields(scheduledMessageErrors({ ...payload, message_reference: { message_id: x(65) } })), ["message_reference.message_id"]);
});

test("generated GitHub embeds are clipped to Discord's embed limits instead of being rejected", () => {
    const embeds = [{ title: x(300), description: x(5000), author: { name: x(300) }, footer: { text: x(3000) }, fields: [{ name: x(300), value: x(2000) }] }, { title: "short" }];
    clampEmbedText(embeds);
    assert.equal(embeds[0].title.length, 256);
    assert.ok(embeds[0].title.endsWith("..."));
    assert.equal(embeds[0].description.length, 4096);
    assert.equal(embeds[0].author.name.length, 256);
    assert.equal(embeds[0].footer.text.length, 2048);
    assert.equal(embeds[0].fields[0].name.length, 256);
    assert.equal(embeds[0].fields[0].value.length, 1024);
    assert.deepEqual(embeds[1], { title: "short" });
    assert.equal(clampEmbedText(undefined), undefined);
});

test("a user message body can't carry interaction metadata", () => {
    const database = process.env.DATABASE;
    process.env.DATABASE ??= "postgres://localhost/fosscord_field_caps_unused";
    require("../../dist/util");
    const ajv = require("../../dist/schemas").getAjv();
    if (database === undefined) delete process.env.DATABASE;
    for (const schema of ["MessageCreateSchema", "MessageEditSchema"]) {
        assert.equal(ajv.validate(schema, { content: "hi" }), true, schema);
        for (const key of ["interaction", "interaction_metadata"])
            assert.equal(ajv.validate(schema, { content: "hi", [key]: { id: "1", type: 2, name: "x", user_id: "1" } }), false, `${schema} ${key}`);
    }
    const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "../../src/api/util/handlers/UserMessage.ts"), "utf8");
    assert.match(source, /interaction_metadata: undefined/);
});
