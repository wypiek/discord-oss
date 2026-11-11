const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");

const UNKNOWN_CHANNEL = new Error("Unknown channel");

const load = (channels, recipients) => {
    const routes = [];
    const router = { post: (path, options, handler) => routes.push({ path, options, handler }) };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync("dist/api/routes/channels/#channel_id/blocked-user-warning-dismissal.js", "utf8"), {
        module,
        exports: module.exports,
        require: (name) =>
            ({
                express: { Router: () => router },
                "@spacebar/api/middlewares": { route: (options) => options },
                "@spacebar/database": {
                    Channel: { findOne: async ({ where }) => channels.find((channel) => channel.id === where.id) ?? null },
                    Recipient: {
                        update: async (where, values) => {
                            const matches = recipients.filter((recipient) => recipient.channel_id === where.channel_id && recipient.user_id === where.user_id);
                            for (const recipient of matches) Object.assign(recipient, values);
                            return { affected: matches.length };
                        },
                    },
                },
                "@spacebar/util": { DiscordApiErrors: { UNKNOWN_CHANNEL } },
                "@spacebar/schemas": { ChannelType: { DM: 1, GROUP_DM: 3 } },
            })[name],
    });
    return routes[0];
};

const dismiss = async (route, user_id, channel_id) => {
    let status;
    await route.handler({ user_id, params: { channel_id } }, { sendStatus: (code) => (status = code) });
    return status;
};

test("dismissing the blocked user warning marks only the caller's membership in a group DM", async () => {
    const recipients = [
        { channel_id: "g", user_id: "1", blocked_user_warning_dismissed: false },
        { channel_id: "g", user_id: "2", blocked_user_warning_dismissed: false },
    ];
    const route = load([{ id: "g", type: 3 }], recipients);
    assert.equal(route.path, "/");
    assert.equal(await dismiss(route, "1", "g"), 204);
    assert.deepEqual(
        recipients.map((recipient) => recipient.blocked_user_warning_dismissed),
        [true, false],
    );
});

test("the dismissal answers Unknown Channel for DMs, unknown channels and group DMs the caller is not in", async () => {
    const route = load(
        [
            { id: "d", type: 1 },
            { id: "g", type: 3 },
        ],
        [{ channel_id: "g", user_id: "2", blocked_user_warning_dismissed: false }],
    );
    await assert.rejects(dismiss(route, "1", "d"), UNKNOWN_CHANNEL);
    await assert.rejects(dismiss(route, "1", "missing"), UNKNOWN_CHANNEL);
    await assert.rejects(dismiss(route, "1", "g"), UNKNOWN_CHANNEL);
});

test("both backends add the dismissal column idempotently", () => {
    const postgres = fs.readFileSync("src/database/migration/postgres/1793281574629-BlockedUserWarningDismissal.ts", "utf8");
    const sqlite = fs.readFileSync("src/database/migration/sqlite/1793281574629-BlockedUserWarningDismissal.ts", "utf8");
    assert.match(postgres, /ADD COLUMN IF NOT EXISTS "blocked_user_warning_dismissed" boolean NOT NULL DEFAULT false/);
    assert.match(sqlite, /hasColumn\(queryRunner, "recipients", "blocked_user_warning_dismissed"\)/);
});
