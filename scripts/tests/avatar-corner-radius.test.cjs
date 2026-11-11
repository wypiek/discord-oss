const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const dist = (file) => path.join(root, "dist", file);
const built = fs.existsSync(dist("util/util/AvatarCornerRadius.js"));

test("only whole numbers from 0 to 50 are corner radii", { skip: !built && "build first" }, () => {
    const { isAvatarCornerRadius, readAvatarCornerRadius } = require(dist("util/util/AvatarCornerRadius.js"));
    for (const value of [0, 1, 25, 49, 50]) assert.equal(isAvatarCornerRadius(value), true, String(value));
    for (const value of [-1, 51, 12.5, Number.NaN, Number.POSITIVE_INFINITY, "25", null, undefined, true, {}, [25]])
        assert.equal(isAvatarCornerRadius(value), false, String(value));
    assert.equal(readAvatarCornerRadius(25), 25);
    assert.equal(readAvatarCornerRadius("25"), null);
    assert.equal(readAvatarCornerRadius(99), null);
});

test("the request schema takes 0 to 50 or null and refuses everything else", { skip: !built && "build first" }, () => {
    const { validateSchema } = require(dist("schemas/Validator.js"));
    const log = console.log;
    console.log = () => {};
    try {
        for (const value of [0, 12, 50, null]) assert.doesNotThrow(() => validateSchema("UserModifySchema", { avatar_corner_radius: value }), `value ${JSON.stringify(value)}`);
        for (const value of [-1, 51, 12.5, "square", [], {}])
            assert.throws(() => validateSchema("UserModifySchema", { avatar_corner_radius: value }), `value ${JSON.stringify(value)}`);
    } finally {
        console.log = log;
    }
});

test("public payloads carry a set radius and leave out the default", { skip: !built && "build first" }, () => {
    const { User } = require(dist("database/entities/index.js"));
    const make = (avatar_corner_radius) =>
        Object.assign(new User(), {
            id: "1",
            username: "square",
            discriminator: "0",
            public_flags: 0,
            bot: false,
            system: false,
            avatar_corner_radius,
        });
    const square = make(0);
    assert.equal(square.toPublicUser().avatar_corner_radius, 0);
    assert.equal(square.toPartialUser().avatar_corner_radius, 0);
    assert.equal(make(18).toPartialUser().avatar_corner_radius, 18);
    for (const value of [null, undefined, 77]) {
        const user = make(value);
        assert.equal("avatar_corner_radius" in user.toPublicUser(), false, String(value));
        assert.equal("avatar_corner_radius" in user.toPartialUser(), false, String(value));
        assert.equal(user.toPrivateUser().avatar_corner_radius, null, String(value));
    }
    assert.equal(make(30).toPrivateUser().avatar_corner_radius, 30);
});

test("PATCH /users/@me stores the radius and announces a cleared one as null", () => {
    const route = fs.readFileSync(path.join(root, "src/api/routes/users/@me/index.ts"), "utf8");
    assert.match(route, /body\.avatar_corner_radius !== null && !isAvatarCornerRadius\(body\.avatar_corner_radius\)/);
    assert.match(route, /user\.avatar_corner_radius = body\.avatar_corner_radius;/);
    const presence = fs.readFileSync(path.join(root, "src/util/util/Presence.ts"), "utf8");
    assert.match(presence, /withAvatarCornerRadius\(user, user\.avatar_corner_radius, true\)/);
});

test("users from other instances keep a valid radius and lose an invalid one", { skip: !built && "build first" }, () => {
    const { capRemoteUser, capRemoteMessage } = require(dist("util/util/federation/Caps.js"));
    assert.equal(capRemoteUser({ id: "1", avatar_corner_radius: 20 }).avatar_corner_radius, 20);
    assert.equal(capRemoteUser({ id: "1", avatar_corner_radius: null }).avatar_corner_radius, null);
    for (const value of [-4, 51, 2.5, "0", { evil: true }]) assert.equal(capRemoteUser({ id: "1", avatar_corner_radius: value }).avatar_corner_radius, null, String(value));
    assert.equal("avatar_corner_radius" in capRemoteUser({ id: "1" }), false);
    const message = capRemoteMessage({ author: { id: "1", avatar_corner_radius: 900 }, mentions: [{ id: "2", avatar_corner_radius: 10 }] }, 2000);
    assert.equal(message.author.avatar_corner_radius, null);
    assert.equal(message.mentions[0].avatar_corner_radius, 10);
});

test("federation profiles and shadows carry the radius", () => {
    const shadows = fs.readFileSync(path.join(root, "src/api/util/utility/federationShadows.ts"), "utf8");
    assert.match(shadows, /const PROFILE_KEYS = \[[^\]]*"avatar_corner_radius"[^\]]*\]/);
    assert.match(shadows, /avatar_corner_radius: readAvatarCornerRadius\(user\.avatar_corner_radius\)/);
    assert.match(shadows, /avatar_corner_radius: readAvatarCornerRadius\(raw\.avatar_corner_radius\)/);
    for (const file of ["federationHome.ts", "federationRelay.ts", "federationVoice.ts", "federationHost.ts", "federationE2ee.ts", "federationShadows.ts"])
        assert.match(fs.readFileSync(path.join(root, "src/api/util/utility", file), "utf8"), /avatar_corner_radius: true/, file);
});

test("both database backends add the column idempotently", () => {
    for (const backend of ["postgres", "sqlite"]) {
        const dir = path.join(root, "src/database/migration", backend);
        const file = fs.readdirSync(dir).find((name) => name.endsWith("-AvatarCornerRadius.ts"));
        assert.ok(file, backend);
        const source = fs.readFileSync(path.join(dir, file), "utf8");
        assert.match(source, backend === "postgres" ? /ADD COLUMN IF NOT EXISTS "avatar_corner_radius" integer/ : /hasColumn\(queryRunner, "users", "avatar_corner_radius"\)/);
    }
});

test("the client plugin keeps the radius on user records and reshapes avatars", () => {
    const plugin = fs.readFileSync(path.join(root, "client/plugins/fosscordAvatarShape/index.tsx"), "utf8");
    assert.match(plugin, /DefaultCustomizationSections: user cannot be undefined/);
    assert.match(plugin, /avatar_corner_radius/);
    assert.match(plugin, /required: true/);
});
