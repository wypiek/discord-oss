const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const {
    AUDIT_LOG_REASON_MAX,
    auditLogReason,
    discoveryMetadataCaps,
    fieldCaps,
    newMemberWelcomeCaps,
    onboardingCaps,
    onboardingResponsesCaps,
} = require("../../src/api/util/utility/fieldCaps.ts");

const root = path.join(__dirname, "..", "..");
const long = (n) => "a".repeat(n);
const fieldErrors = (fn) => {
    try {
        fn();
    } catch (error) {
        assert.equal(error.code, 50035);
        return error.errors;
    }
    assert.fail("expected a form body error");
};

test("the audit log reason header is capped at 512 characters after decoding", () => {
    assert.equal(AUDIT_LOG_REASON_MAX, 512);
    assert.equal(auditLogReason(undefined), undefined);
    assert.equal(auditLogReason(encodeURIComponent("spam é")), "spam é");
    assert.equal(auditLogReason([long(512), long(600)]), long(512));
    assert.equal(auditLogReason("%E0%A4%A"), "%E0%A4%A");
    assert.ok(fieldErrors(() => auditLogReason(long(513)))["x-audit-log-reason"]);
    assert.equal(auditLogReason(encodeURIComponent(long(512))), long(512));
    assert.ok(fieldErrors(() => auditLogReason(encodeURIComponent("é".repeat(513))))["x-audit-log-reason"]);
});

test("fieldCaps reports wrong types, long strings and long arrays", () => {
    const caps = fieldCaps();
    caps.text("a", long(10), 10);
    caps.text("b", long(11), 10);
    caps.text("c", 5, 10);
    caps.text("d", "x", 10, 2);
    caps.texts("e", ["ok", long(21)], 5, 20);
    caps.list("f", [1, 2, 3], 2);
    caps.list("g", "nope", 2);
    assert.deepEqual(Object.keys(caps.errors).sort(), ["b", "c", "d", "e.1", "f", "g"]);
    assert.equal(caps.errors.d.code, "BASE_TYPE_BAD_LENGTH");
    assert.equal(caps.errors.b.code, "BASE_TYPE_MAX_LENGTH");
    assert.ok(fieldErrors(() => caps.check()).b);
});

test("onboarding prompts and options are capped", () => {
    const option = { id: "1", title: "Chat", description: "", channel_ids: ["2"], role_ids: [], emoji: { id: null, name: "👽" } };
    onboardingCaps({ prompts: [{ id: "1", title: "What do you like?", options: [option] }], default_channel_ids: ["3"] });
    onboardingCaps(undefined);
    const errors = fieldErrors(() =>
        onboardingCaps({
            prompts: [{ id: "1", title: long(101), options: [{ ...option, title: long(51), description: long(101), emoji: { name: long(33) } }] }],
            default_channel_ids: [long(21)],
        }),
    );
    for (const key of ["prompts.0.title", "prompts.0.options.0.title", "prompts.0.options.0.description", "prompts.0.options.0.emoji.name", "default_channel_ids.0"])
        assert.ok(errors[key], key);
    assert.ok(fieldErrors(() => onboardingCaps({ prompts: Array.from({ length: 16 }, () => ({ title: "x", options: [] })) })).prompts);
    assert.ok(fieldErrors(() => onboardingCaps({ prompts: [{ title: "x", options: Array.from({ length: 51 }, () => option) }] }))["prompts.0.options"]);
});

test("onboarding responses are capped", () => {
    onboardingResponsesCaps({ onboarding_responses: ["1", "2"], onboarding_prompts_seen: { 1: 5 } });
    const errors = fieldErrors(() =>
        onboardingResponsesCaps({
            onboarding_responses: Array.from({ length: 751 }, () => "1"),
            onboarding_responses_seen: { [long(30)]: 1 },
            onboarding_prompts_seen: "x",
        }),
    );
    assert.ok(errors.onboarding_responses);
    assert.ok(errors[`onboarding_responses_seen.${long(20)}`]);
    assert.ok(errors.onboarding_prompts_seen);
});

test("the new member welcome is capped", () => {
    newMemberWelcomeCaps({ welcome_message: { author_ids: ["1"], message: "hi" }, new_member_actions: [{ channel_id: "1", title: "Say hi", description: "" }] });
    const errors = fieldErrors(() =>
        newMemberWelcomeCaps({
            welcome_message: { author_ids: Array.from({ length: 11 }, () => "1"), message: long(301) },
            new_member_actions: Array.from({ length: 6 }, () => ({ title: long(61), description: long(201) })),
            resource_channels: [{ title: "ok", description: long(201) }],
        }),
    );
    for (const key of [
        "welcome_message.author_ids",
        "welcome_message.message",
        "new_member_actions",
        "new_member_actions.0.title",
        "new_member_actions.0.description",
        "resource_channels.0.description",
    ])
        assert.ok(errors[key], key);
});

test("the discovery metadata is capped", () => {
    discoveryMetadataCaps({ about: long(2400), social_links: ["https://example.org"], reasons_to_join: [{ reason: "Friendly", emoji_name: "😀" }] });
    const errors = fieldErrors(() =>
        discoveryMetadataCaps({
            about: long(2401),
            social_links: [long(257), ...Array.from({ length: 9 }, () => "x")],
            reasons_to_join: [{ reason: long(101) }, {}, {}, {}, {}],
        }),
    );
    for (const key of ["about", "social_links", "social_links.0", "reasons_to_join", "reasons_to_join.0.reason"]) assert.ok(errors[key], key);
});

test("the hand-parsed routes call their caps", () => {
    const read = (file) => fs.readFileSync(path.join(root, "src/api/routes", file), "utf8");
    assert.match(read("guilds/#guild_id/onboarding.ts"), /onboardingCaps\(req\.body\)/);
    assert.match(read("guilds/#guild_id/onboarding-responses.ts"), /onboardingResponsesCaps\(req\.body\)/);
    assert.match(read("guilds/#guild_id/new-member-welcome.ts"), /newMemberWelcomeCaps\(req\.body\)/);
    assert.match(read("guilds/#guild_id/discovery-metadata.ts"), /discoveryMetadataCaps\(body\)/);
    assert.match(read("guilds/#guild_id/bans.ts"), /auditLogReason\(req\.headers\["x-audit-log-reason"\]\)/);
    assert.match(read("guilds/#guild_id/bulk-ban.ts"), /auditLogReason\(req\.headers\["x-audit-log-reason"\]\)/);
    assert.match(read("guilds/#guild_id/scheduled-events.ts"), /MAX_EXCEPTIONS = 100/);
    assert.match(read("guilds/#guild_id/scheduled-events.ts"), /MAX_RECURRENCE_RULE_LENGTH = 2048/);
    assert.match(read("channels/#channel_id/tags.ts"), /MAX_FORUM_TAGS = 20/);
    assert.match(read("stage-instances/#channel_id.ts"), /topic\.length > 120/);
    assert.match(fs.readFileSync(path.join(root, "src/api/middlewares/Route.ts"), "utf8"), /auditLogReason\(req\.headers\["x-audit-log-reason"\]\)/);
});

test("the generated schemas carry the caps", () => {
    const TJS = require("typescript-json-schema");
    const walk = require("../util/walk");
    const settings = { required: true, ignoreErrors: true, excludePrivate: true, defaultNumberType: "integer", noExtraProps: true, defaultProps: false, useTypeOfKeyword: true };
    const program = TJS.programFromConfig(path.join(root, "tsconfig.json"), walk(path.join(root, "src", "schemas")));
    const generator = TJS.buildGenerator(program, settings);
    const schema = (name) => TJS.generateSchema(program, name, settings, [], generator);
    const prop = (name, key) => schema(name).properties[key];

    assert.deepEqual([prop("GuildCreateSchema", "name").minLength, prop("GuildCreateSchema", "name").maxLength], [2, 100]);
    assert.equal(prop("GuildUpdateSchema", "description").maxLength, 300);
    assert.deepEqual([prop("GuildUpdateSchema", "features").maxItems, prop("GuildUpdateSchema", "features").items.maxLength], [100, 64]);
    assert.equal(prop("ChannelModifySchema", "name").maxLength, 100);
    assert.equal(prop("ChannelModifySchema", "topic").maxLength, 4096);
    assert.equal(prop("ChannelModifySchema", "available_tags").maxItems, 20);
    assert.equal(prop("ChannelModifySchema", "available_tags").items.properties.name.maxLength, 20);
    assert.deepEqual([prop("ChannelModifySchema", "applied_tags").maxItems, prop("ChannelModifySchema", "applied_tags").items.maxLength], [5, 20]);
    assert.equal(prop("ChannelModifySchema", "permission_overwrites").items.properties.id.maxLength, 20);
    assert.equal(prop("RoleModifySchema", "name").maxLength, 100);
    assert.equal(prop("RoleModifySchema", "unicode_emoji").maxLength, 32);
    assert.equal(prop("BanCreateSchema", "reason").maxLength, 512);
    assert.deepEqual([prop("BulkBanSchema", "user_ids").maxItems, prop("BulkBanSchema", "user_ids").items.maxLength], [1000, 20]);
    assert.deepEqual([prop("MemberChangeSchema", "roles").maxItems, prop("MemberChangeSchema", "roles").items.maxLength], [1000, 20]);
    assert.equal(prop("EmojiModifySchema", "name").maxLength, 32);
    assert.deepEqual([prop("ModifyGuildStickerSchema", "name").maxLength, prop("ModifyGuildStickerSchema", "tags").maxLength], [30, 200]);
    assert.deepEqual([prop("WebhookCreateSchema", "name").minLength, prop("WebhookCreateSchema", "name").maxLength], [1, 80]);
    assert.equal(prop("WebhookUpdateSchema", "name").maxLength, 80);
    assert.equal(prop("TemplateCreateSchema", "description").maxLength, 120);
    assert.equal(prop("ThreadCreationSchema", "name").maxLength, 100);
    assert.equal(prop("GuildUpdateWelcomeScreenSchema", "description").maxLength, 140);
    assert.equal(prop("GuildUpdateWelcomeScreenSchema", "welcome_channels").maxItems, 5);
    assert.equal(prop("GuildProfileModifySchema", "traits").maxItems, 5);
    assert.equal(prop("GuildMemberVerificationModifySchema", "form_fields").maxItems, 5);
    assert.equal(schema("ChannelReorderSchema").maxItems, 5000);
    const field = schema("GuildMemberVerificationModifySchema").definitions.GuildMemberVerificationFormField.properties;
    assert.equal(field.label.maxLength, 300);
    assert.equal(field.values.anyOf[0].items.maxLength, 300);
    assert.equal(field.choices.anyOf[0].items.maxLength, 150);
});
