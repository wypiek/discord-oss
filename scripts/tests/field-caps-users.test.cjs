const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const TJS = require("typescript-json-schema");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const walk = require("../util/walk");

const root = path.join(__dirname, "..", "..");

const load = (file, imports = {}) => {
    const module = { exports: {} };
    const js = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(js, {
        module,
        exports: module.exports,
        Buffer,
        require: (name) => {
            if (!(name in imports)) throw Error(name);
            return imports[name];
        },
    });
    return module.exports;
};

const fieldError = load("src/util/util/FieldError.ts");
const caps = load("src/util/util/UserFieldCaps.ts", { "./FieldError": fieldError });
const presence = load("src/util/util/Presence.ts", {
    "@spacebar/database": {},
    "@spacebar/util": {},
    "@spacebar/schemas": {},
    typeorm: {},
    "./UserFieldCaps": caps,
    "./AvatarCornerRadius": load("src/util/util/AvatarCornerRadius.ts"),
});

const capped = [
    "RegisterSchema",
    "LoginSchema",
    "ForgotPasswordSchema",
    "UserModifySchema",
    "UserProfileModifySchema",
    "UserSettingsUpdateSchema",
    "UserNoteUpdateSchema",
    "RelationshipModifySchema",
    "SendRelationshipRequestSchema",
    "RelationshipCreateSchema",
    "MemberChangeSchema",
    "MemberChangeProfileSchema",
    "MemberNickChangeSchema",
    "PushDeviceSchema",
    "PushDeviceSyncSchema",
    "SessionsLogoutSchema",
    "DmChannelCreateSchema",
    "ConnectionCallbackSchema",
    "InstanceUserDeleteSchema",
];

const validators = (() => {
    const settings = { required: true, ignoreErrors: true, excludePrivate: true, defaultNumberType: "integer", noExtraProps: true, defaultProps: false, useTypeOfKeyword: true };
    const program = TJS.programFromConfig(path.join(root, "tsconfig.json"), walk(path.join(root, "src", "schemas")));
    const generator = TJS.buildGenerator(program, settings);
    const ajv = new Ajv({ allErrors: true, parseDate: true, allowDate: true, coerceTypes: true, messages: true, strict: true, strictRequired: true, allowUnionTypes: true });
    addFormats(ajv);
    return Object.fromEntries(capped.map((name) => [name, ajv.compile(TJS.generateSchema(program, name, settings, [], generator))]));
})();

const long = (length) => "a".repeat(length);
const plain = (value) => JSON.parse(JSON.stringify(value));
const errorsOf = (name, body) => {
    const validate = validators[name];
    return validate(body) ? [] : validate.errors.map((error) => `${error.instancePath} ${error.keyword}`);
};
const rejects = (name, body, pointer, keyword = "maxLength") => assert.ok(errorsOf(name, body).includes(`${pointer} ${keyword}`), `${name} should reject ${pointer}`);
const accepts = (name, body) => assert.deepEqual(errorsOf(name, body), [], `${name} should accept ${JSON.stringify(body).slice(0, 200)}`);

test("registration and login cap their names and keys", () => {
    accepts("RegisterSchema", { consent: true, username: long(32), global_name: long(32), email: "a@b.co" });
    rejects("RegisterSchema", { consent: true, username: long(33) }, "/username");
    rejects("RegisterSchema", { consent: true, global_name: long(33) }, "/global_name");
    rejects("RegisterSchema", { consent: true, fingerprint: long(129) }, "/fingerprint");
    rejects("RegisterSchema", { consent: true, captcha_key: long(16385) }, "/captcha_key");
    accepts("LoginSchema", { login: "someone@example.com", password: "hunter2" });
    rejects("LoginSchema", { login: long(321), password: "hunter2" }, "/login");
    rejects("ForgotPasswordSchema", { login: long(321) }, "/login");
});

test("user and profile edits use Discord's limits", () => {
    accepts("UserModifySchema", { username: long(32), global_name: long(32), bio: long(190), display_name_colors: [1, 2] });
    rejects("UserModifySchema", { username: long(33) }, "/username");
    rejects("UserModifySchema", { global_name: long(33) }, "/global_name");
    rejects("UserModifySchema", { bio: long(191) }, "/bio");
    rejects("UserModifySchema", { avatar_description: long(1025) }, "/avatar_description");
    rejects("UserModifySchema", { display_name_colors: [1, 2, 3, 4, 5, 6, 7, 8, 9] }, "/display_name_colors", "maxItems");
    accepts("UserProfileModifySchema", { bio: long(190), pronouns: long(40), theme_colors: [1, 2], collectibles_sku_ids: ["1"] });
    rejects("UserProfileModifySchema", { pronouns: long(41) }, "/pronouns");
    rejects("UserProfileModifySchema", { bio: long(191) }, "/bio");
    rejects("UserProfileModifySchema", { theme_colors: [1, 2, 3] }, "/theme_colors", "maxItems");
    rejects("UserProfileModifySchema", { collectibles_sku_ids: [long(65)] }, "/collectibles_sku_ids/0");
});

test("custom status, notes and relationships are capped", () => {
    accepts("UserSettingsUpdateSchema", { custom_status: { text: long(128), emoji_name: "🏳️‍⚧️" }, locale: "en-US" });
    rejects("UserSettingsUpdateSchema", { custom_status: { text: long(129) } }, "/custom_status/text");
    rejects("UserSettingsUpdateSchema", { custom_status: { emoji_name: long(33) } }, "/custom_status/emoji_name");
    rejects("UserSettingsUpdateSchema", { locale: long(17) }, "/locale");
    rejects("UserSettingsUpdateSchema", { guild_folders: [{ guild_ids: [], name: long(101) }] }, "/guild_folders/0/name");
    rejects("UserNoteUpdateSchema", { note: long(257) }, "/note");
    rejects("RelationshipModifySchema", { nickname: long(33) }, "/nickname");
    rejects("SendRelationshipRequestSchema", { username: long(33), discriminator: null }, "/username");
    rejects("RelationshipCreateSchema", { note: long(121) }, "/note");
});

test("member self edits cap nick, bio and pronouns", () => {
    accepts("MemberChangeProfileSchema", { nick: long(32), bio: long(190), pronouns: long(40) });
    rejects("MemberChangeProfileSchema", { nick: long(33) }, "/nick");
    rejects("MemberChangeProfileSchema", { bio: long(191) }, "/bio");
    rejects("MemberChangeProfileSchema", { pronouns: long(41) }, "/pronouns");
    rejects("MemberChangeSchema", { nick: long(33) }, "/nick");
    rejects("MemberChangeSchema", { bio: long(191) }, "/bio");
    rejects("MemberNickChangeSchema", { nick: long(33) }, "/nick");
});

test("devices, sessions and DMs cap their lists", () => {
    accepts("PushDeviceSchema", { provider: "webpush", token: long(4096) });
    rejects("PushDeviceSchema", { provider: "webpush", token: long(4097) }, "/token");
    rejects("PushDeviceSyncSchema", { provider: "fcm", token: "t", push_sync_tokens: Array(21).fill("x") }, "/push_sync_tokens", "maxItems");
    rejects("SessionsLogoutSchema", { session_ids: Array(1001).fill("1") }, "/session_ids", "maxItems");
    rejects("DmChannelCreateSchema", { name: long(101) }, "/name");
    rejects("ConnectionCallbackSchema", { state: long(513), insecure: false, friend_sync: false }, "/state");
    rejects("InstanceUserDeleteSchema", { reason: long(513) }, "/reason");
});

test("avatars and banners keep room for large data URIs", () => {
    const image = `data:image/png;base64,${long(4 * 1024 * 1024)}`;
    accepts("UserModifySchema", { avatar: image, banner: image });
    accepts("MemberChangeProfileSchema", { banner: image });
});

test("assertMaxLength counts code points and throws a field error", () => {
    assert.doesNotThrow(() => caps.assertMaxLength("nick", "🏳️‍🌈".repeat(8), 32));
    assert.doesNotThrow(() => caps.assertMaxLength("nick", undefined, 32));
    assert.throws(
        () => caps.assertMaxLength("nick", long(33), 32),
        (error) => error.code === 50035 && error.errors.nick._errors[0].code === "BASE_TYPE_MAX_LENGTH",
    );
    assert.equal(caps.clampText("😀".repeat(5), 3), "😀😀😀");
});

test("findOversizedField reports the first oversized path", () => {
    assert.equal(caps.findOversizedField({ type: "favorite_games", games: [{ comment: "ok" }] }, 256, 50), null);
    assert.equal(caps.findOversizedField({ games: [{ comment: long(257) }] }, 256, 50), "games.0.comment");
    assert.equal(caps.findOversizedField({ games: Array(51).fill({}) }, 256, 50), "games");
});

test("presence activities are truncated to Discord's limits", () => {
    const [activity] = presence.sanitizeActivities([
        {
            name: long(500),
            type: 0,
            state: long(500),
            details: long(500),
            url: long(2000),
            emoji: { name: long(100), id: "1", animated: false },
            party: { id: long(500), size: [1, 2] },
            assets: { large_text: long(500), small_text: long(500), large_image: "mp:external/abc" },
            secrets: { join: long(500) },
            buttons: [
                { label: long(100), url: long(1000) },
                { label: "two", url: "https://example.com" },
                { label: "three", url: "https://example.com" },
            ],
            metadata: { button_urls: Array(20).fill(long(1000)) },
            flags: { nested: true },
            extra: long(500),
        },
    ]);
    assert.equal(activity.name.length, 128);
    assert.equal(activity.state.length, 128);
    assert.equal(activity.details.length, 128);
    assert.equal(activity.url.length, 512);
    assert.equal(activity.emoji.name.length, 32);
    assert.equal(activity.party.id.length, 128);
    assert.deepEqual(plain(activity.party.size), [1, 2]);
    assert.equal(activity.assets.large_text.length, 128);
    assert.equal(activity.assets.small_text.length, 128);
    assert.equal(activity.assets.large_image, "mp:external/abc");
    assert.equal(activity.secrets.join.length, 128);
    assert.equal(activity.buttons.length, 2);
    assert.equal(activity.buttons[0].label.length, 32);
    assert.equal(activity.buttons[0].url.length, 512);
    assert.equal(activity.metadata.button_urls.length, 10);
    assert.equal(activity.metadata.button_urls[0].length, 512);
    assert.equal(activity.flags, undefined);
    assert.equal(activity.extra, undefined);
});

test("custom status activities and string buttons pass through when they fit", () => {
    const [custom, rich] = presence.sanitizeActivities([
        { name: "Custom Status", type: 4, state: "hi", emoji: { name: "🏳️‍⚧️" }, created_at: 5 },
        { name: "Game", type: "0", buttons: ["Join", long(40)] },
    ]);
    assert.deepEqual(plain(custom), { name: "Custom Status", type: 4, state: "hi", emoji: { name: "🏳️‍⚧️" }, created_at: 5 });
    assert.equal(rich.type, 0);
    assert.deepEqual(plain(rich.buttons), ["Join", long(32)]);
});
