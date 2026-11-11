import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const origin = `http://localhost:${process.env.PORT || 3290}/api/v9`;
const account = Object.fromEntries(
    readFileSync(new URL("./.test-account", import.meta.url), "utf8")
        .trim()
        .split("\n")
        .map((line) => line.split("=")),
);
const request = async (path, token, body, method = body ? "PATCH" : "GET") => {
    const res = await fetch(origin + path, {
        method,
        headers: { "content-type": "application/json", ...(token ? { authorization: token } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, data: text ? JSON.parse(text) : null };
};
const login = async (email, password) => {
    const result = await request("/auth/login", null, { login: email, password }, "POST");
    assert.equal(result.status, 200);
    return result.data.token;
};
const token = await login(account.TEST_EMAIL, account.TEST_PASSWORD);
const friend = await login("friend@fosscord.test", account.FRIEND_PASSWORD);
const myResponse = await request("/users/@me", token);
assert.equal(myResponse.status, 200, JSON.stringify(myResponse.data));
const me = myResponse.data;
const friendResponse = await request("/users/@me", friend);
assert.equal(friendResponse.status, 200, JSON.stringify(friendResponse.data));
const them = friendResponse.data;
assert.ok(them.id, "friend id missing");
assert.equal((await request("/admin", friend)).status, 403);
assert.equal((await request("/admin/system/performance", friend)).status, 403);
const original = (await request(`/admin/users/${them.id}`, token)).data;
const profile = {
    global_name: "Dashboard profile test",
    pronouns: "they/them",
    bio: "Edited through the admin dashboard",
    accent_color: 0x5865f2,
    theme_colors: [0x5865f2, 0x232428],
};
const profileResult = await request(`/admin/users/${them.id}`, token, profile);
assert.equal(profileResult.status, 200, JSON.stringify(profileResult.data));
const stored = (await request(`/admin/users/${them.id}`, token)).data;
for (const [key, value] of Object.entries(profile)) assert.deepEqual(stored[key], value);
assert.equal((await request(`/admin/users/${them.id}`, token, { theme_colors: [-1, 42] })).status, 400);
assert.equal((await request(`/admin/users/${them.id}`, token, { avatar: "https://example.com/x.png" })).status, 400);
const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jIWsAAAAASUVORK5CYII=";
const uploaded = await request(`/admin/users/${them.id}`, token, { avatar: image, banner: image });
assert.equal(uploaded.status, 200, JSON.stringify(uploaded.data));
assert.ok((await request(`/admin/users/${them.id}`, token)).data.banner);
assert.equal(
    (
        await request(`/admin/users/${them.id}`, token, {
            avatar: null,
            banner: null,
            accent_color: null,
            theme_colors: null,
        })
    ).status,
    200,
);
const cleared = (await request(`/admin/users/${them.id}`, token)).data;
for (const field of ["avatar", "banner", "accent_color", "theme_colors"]) assert.equal(cleared[field], null);
await request(`/admin/users/${them.id}`, token, {
    global_name: original.global_name,
    pronouns: original.pronouns,
    bio: original.bio,
    accent_color: original.accent_color,
    theme_colors: original.theme_colors,
});
console.log("PASS user fields persist, upload/clear artwork, validation, access restrictions");
const guilds = (await request("/admin/guilds?q=Test%20Guild", token)).data.guilds;
const g = guilds[0];
assert.ok(g);
const before = (await request(`/admin/guilds/${g.id}`, token)).data;
const guildPatch = {
    verification_level: 2,
    explicit_content_filter: 1,
    default_message_notifications: 1,
    premium_tier: 3,
    nsfw: false,
    preferred_locale: "en-US",
    afk_timeout: 900,
};
assert.equal((await request(`/admin/guilds/${g.id}`, token, guildPatch)).status, 200);
for (const [key, value] of Object.entries(guildPatch)) assert.deepEqual((await request(`/admin/guilds/${g.id}`, token)).data[key], value);
await request(`/admin/guilds/${g.id}`, token, Object.fromEntries(Object.keys(guildPatch).map((key) => [key, before[key]])));
const channels = (await request(`/admin/guilds/${g.id}/channels`, token)).data.channels;
const channel = channels.find((x) => x.type === 0);
assert.ok(channel);
assert.equal(
    (
        await request(`/admin/guilds/${g.id}/channels/${channel.id}`, token, {
            topic: "Admin topic test",
            rate_limit_per_user: 3,
        })
    ).status,
    200,
);
assert.equal((await request(`/channels/${channel.id}`, token)).data.topic, "Admin topic test");
assert.equal(
    (
        await request(`/admin/guilds/${g.id}/channels/${channel.id}`, token, {
            parent_id: "999999999999999999",
        })
    ).status,
    404,
);
await request(`/admin/guilds/${g.id}/channels/${channel.id}`, token, {
    topic: channel.topic,
    rate_limit_per_user: channel.rate_limit_per_user,
});
const roles = (await request(`/admin/guilds/${g.id}/roles`, token)).data;
assert.ok(roles.permissions.length);
const role = roles.roles.find((x) => !x.managed);
assert.ok(role);
assert.equal((await request(`/admin/guilds/${g.id}/roles/${role.id}`, token, { color: 0x5865f2 })).status, 200);
assert.equal((await request(`/admin/guilds/${g.id}/roles`, token)).data.roles.find((x) => x.id === role.id).color, 0x5865f2);
await request(`/admin/guilds/${g.id}/roles/${role.id}`, token, { color: role.color });
console.log("PASS server settings, channel edits and role edits persist");
const settings = (await request("/admin/settings", token)).data;
const result = await request("/admin/settings", token, {
    limits: { user: { maxBio: 500 }, message: { maxCharacters: 8000 } },
    externalRequests: { discordDecorations: true, thirdParty: false },
});
assert.equal(result.status, 200);
assert.equal(result.data.limits.user.maxBio, 500);
assert.equal(result.data.limits.message.maxCharacters, 8000);
assert.equal((await request("/admin/settings", token, { limits: { user: { maxBio: 0 } } })).status, 400);
await request("/admin/settings", token, {
    limits: settings.limits,
    externalRequests: settings.externalRequests,
});
const perf = (await request("/admin/system/performance", token)).data;
assert.ok(perf.database.connected);
assert.ok(perf.requests > 0);
assert.ok(perf.routes.length);
assert.ok(perf.routes.every((x) => !x.path.includes(me.id)));
console.log("PASS feature limits, external policy and bounded diagnostics");
