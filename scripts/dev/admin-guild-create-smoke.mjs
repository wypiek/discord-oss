import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const origin = `http://localhost:${process.env.PORT || 3290}/api/v9`;
const account = Object.fromEntries(
    readFileSync(process.env.TEST_ACCOUNT_FILE || new URL("./.test-account", import.meta.url), "utf8")
        .trim()
        .split("\n")
        .map((line) => {
            const at = line.indexOf("=");
            return [line.slice(0, at), line.slice(at + 1)];
        }),
);
const request = async (token, method, path, body) => {
    const response = await fetch(`${origin}${path}`, {
        method,
        headers: { "content-type": "application/json", ...(token ? { authorization: token } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = response.status === 204 ? null : await response.json();
    return { status: response.status, data };
};
const login = async (email, password) => {
    const response = await request(undefined, "POST", "/auth/login", { login: email, password });
    assert.equal(response.status, 200);
    assert.equal(typeof response.data.token, "string");
    return response.data.token;
};
const admin = await login(account.TEST_EMAIL, account.TEST_PASSWORD);
const friend = await login("friend@fosscord.test", account.FRIEND_PASSWORD);
const guilds = [];
try {
    const server = await request(friend, "POST", "/guilds", {
        name: "Disposable admin creation API check",
    });
    assert.equal(server.status, 201);
    guilds.push(server.data.id);
    const path = `/admin/guilds/${server.data.id}`;
    assert.equal((await request(friend, "POST", `${path}/channels`, { name: "Denied" })).status, 403);
    assert.equal((await request(undefined, "POST", `${path}/roles`, { name: "Denied" })).status, 401);
    const category = await request(admin, "POST", `${path}/channels`, {
        name: "Admin category",
        type: 4,
    });
    assert.equal(category.status, 201);
    const channels = await Promise.all(
        [0, 1, 2].map((index) =>
            request(admin, "POST", `${path}/channels`, {
                name: `Admin text ${index}`,
                parent_id: category.data.id,
            }),
        ),
    );
    assert.ok(channels.every((channel) => channel.status === 201));
    assert.ok(channels.every((channel) => channel.data.parent_id === category.data.id));
    assert.equal(new Set(channels.map((channel) => channel.data.position)).size, 3);
    const voice = await request(admin, "POST", `${path}/channels`, {
        name: "Admin voice",
        type: 2,
        bitrate: 64000,
        user_limit: 10,
    });
    assert.equal(voice.status, 201);
    assert.equal(voice.data.bitrate, 64000);
    assert.equal(voice.data.user_limit, 10);
    assert.equal((await request(admin, "POST", `${path}/channels`, { name: "Invalid", type: 1 })).status, 400);
    assert.equal((await request(admin, "POST", `${path}/channels`, { name: "Invalid", parent_id: "abc" })).status, 400);
    const role = await request(admin, "POST", `${path}/roles`, {
        name: "Admin role",
        color: 16711680,
        permissions: "8",
        hoist: true,
        mentionable: true,
    });
    assert.equal(role.status, 201);
    assert.equal(role.data.permissions, "8");
    assert.equal(role.data.colors.primary_color, 16711680);
    assert.equal(role.data.managed, false);
    assert.equal(
        (
            await request(admin, "POST", `${path}/roles`, {
                name: "Invalid",
                permissions: "9223372036854775808",
            })
        ).status,
        400,
    );
    const listed = await request(admin, "GET", `${path}/channels`);
    assert.ok([category.data.id, voice.data.id, ...channels.map((channel) => channel.data.id)].every((id) => listed.data.channels.some((channel) => channel.id === id)));
} finally {
    for (const id of guilds) {
        const deleted = await request(friend, "POST", `/guilds/${id}/delete`);
        assert.equal(deleted.status, 204);
    }
}

console.log(
    JSON.stringify({
        status: "passed",
        channelCreates: 5,
        roleCreates: 1,
        concurrentChannelCreates: 3,
        unauthorizedStatus: 403,
        invalidInputStatus: 400,
        cleanupStatus: 204,
    }),
);
