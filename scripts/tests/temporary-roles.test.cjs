const assert = require("node:assert/strict");
const { test } = require("node:test");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("temporary roles expire once, announce the removal, survive restarts and follow role removal", { timeout: 60_000 }, async () => {
    if (process.env.TEMPORARY_ROLES_TEST_CHILD !== "1") {
        const directory = mkdtempSync(path.join(tmpdir(), "meowcord-temporary-roles-"));
        try {
            writeFileSync(
                path.join(directory, "config.json"),
                JSON.stringify({
                    general: { serverName: "http://localhost:3001" },
                    api: { endpointPublic: "http://localhost:3001/api/v9" },
                    cdn: { endpointPublic: "http://localhost:3001", endpointPrivate: "http://localhost:3001" },
                    gateway: { endpointPublic: "ws://localhost:3001" },
                }),
            );
            const result = spawnSync(process.execPath, ["test", __filename], {
                env: {
                    ...process.env,
                    TEMPORARY_ROLES_TEST_CHILD: "1",
                    APPLY_DB_MIGRATIONS: "true",
                    DB_LOGGING: "",
                    DATABASE: `sqlite:${path.join(directory, "database.sqlite")}`,
                    DB_SYNC: "",
                    CONFIG_PATH: path.join(directory, "config.json"),
                },
                encoding: "utf8",
                timeout: 55_000,
            });
            assert.equal(result.status, 0, result.stdout + result.stderr);
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
        return;
    }
    const { initDatabase, closeDatabase } = require("../../dist/database");
    const { AuditLog, Guild, Member, MemberRoleExpiration, Role, User } = require("../../dist/database/entities");
    const { Config } = require("../../dist/util/util/Config.js");
    const { onEmitEvent } = require("../../dist/util/util/ipc/Event.js");
    const worker = require("../../dist/api/util/handlers/TemporaryRoles.js");
    const database = await initDatabase();
    try {
        await Config.init();
        const events = [];
        onEmitEvent((payload) => {
            if (payload.event === "GUILD_MEMBER_UPDATE") events.push(payload);
        });
        const owner = await User.register({ username: "temporary_owner", password: "temporary-test-only" });
        const friend = await User.register({ username: "temporary_friend", password: "temporary-test-only" });
        const guild = await Guild.createGuild({ name: "Temporary roles", owner_id: owner.id, source_guild_id: null });
        await Member.addToGuild(friend.id, guild.id);
        const makeRole = (name, position) =>
            Role.create({
                guild_id: guild.id,
                name,
                color: 0,
                colors: { primary_color: 0 },
                hoist: false,
                managed: false,
                mentionable: false,
                permissions: "0",
                position,
                flags: 0,
            }).save();
        const [event, trial, kept] = [await makeRole("Event Access", 1), await makeRole("Trial Member", 2), await makeRole("Kept", 3)];
        const held = async () => (await Member.findOneOrFail({ where: { id: friend.id, guild_id: guild.id }, relations: { roles: true } })).roles.map((role) => role.id);
        const expire = (role_id, date) =>
            database.query(`UPDATE "member_role_expirations" SET "expires_at" = $1 WHERE "role_id" = $2`, [date.toISOString().replace("T", " ").replace("Z", ""), role_id]);

        await Member.addRole(friend.id, guild.id, event.id, { expires_at: new Date(Date.now() + 3600_000), assigned_by: owner.id });
        await Member.addRole(friend.id, guild.id, trial.id, { expires_at: new Date(Date.now() + 3600_000), assigned_by: owner.id });
        await Member.addRole(friend.id, guild.id, kept.id, { expires_at: null, assigned_by: owner.id });
        const assignedEvent = events.at(-2);
        assert.ok(assignedEvent.data.role_expirations[event.id]);
        assert.deepEqual(Object.keys(await MemberRoleExpiration.forMember(guild.id, friend.id)).sort(), [event.id, trial.id].sort());

        assert.equal(await worker.expireTemporaryRoles(), 0);
        assert.deepEqual((await held()).filter((id) => id !== guild.id).sort(), [event.id, trial.id, kept.id].sort());

        const member = await Member.findOneOrFail({ where: { id: friend.id, guild_id: guild.id }, relations: { roles: true } });
        member.roles = member.roles.filter((role) => role.id !== kept.id);
        await member.save();
        assert.equal(Object.keys(await MemberRoleExpiration.forMember(guild.id, friend.id)).length, 2, "saving other role changes keeps expiries");

        await expire(event.id, new Date(Date.now() - 1000));
        const before = events.length;
        const [first, second] = await Promise.all([worker.expireTemporaryRoles(), worker.expireTemporaryRoles()]);
        assert.equal(first, 1);
        assert.equal(second, 1, "a concurrent call joins the running sweep");
        assert.equal(await worker.expireTemporaryRoles(), 0, "an expired role is removed once");
        assert.deepEqual(await held().then((ids) => ids.filter((id) => id !== guild.id)), [trial.id]);
        const removal = events.slice(before);
        assert.equal(removal.length, 1);
        assert.equal(removal[0].guild_id, guild.id);
        assert.equal(removal[0].data.user.id, friend.id);
        assert.ok(!removal[0].data.roles.includes(event.id));
        assert.deepEqual(Object.keys(removal[0].data.role_expirations), [trial.id]);
        const logs = await AuditLog.find({ where: { guild_id: guild.id, target_id: friend.id, reason: worker.TEMPORARY_ROLE_EXPIRED_REASON } });
        assert.equal(logs.length, 1);
        assert.equal(logs[0].user_id, owner.id);
        assert.equal(logs[0].changes[0].key, "$remove");
        assert.equal(logs[0].changes[0].new_value[0].id, event.id);
        assert.equal(logs[0].changes[0].new_value[0].name, "Event Access");

        await Member.addRole(friend.id, guild.id, event.id, { expires_at: new Date(Date.now() + 3600_000), assigned_by: owner.id });
        await Member.removeRole(friend.id, guild.id, event.id);
        assert.equal((await MemberRoleExpiration.forMember(guild.id, friend.id))[event.id], undefined, "manual removal deletes the expiry");

        await Member.addRole(friend.id, guild.id, event.id, { expires_at: new Date(Date.now() + 3600_000), assigned_by: owner.id });
        await database.query(`DELETE FROM "member_roles" WHERE "role_id" = $1`, [event.id]);
        assert.equal(await MemberRoleExpiration.countBy({ role_id: event.id }), 0, "the expiry follows the role assignment row");

        await Member.addRole(friend.id, guild.id, event.id, { expires_at: new Date(Date.now() + 3600_000), assigned_by: owner.id });
        await Member.addRole(friend.id, guild.id, event.id, { expires_at: null, assigned_by: owner.id });
        assert.equal(await MemberRoleExpiration.countBy({ role_id: event.id }), 0, "a permanent assignment clears the expiry");

        await expire(trial.id, new Date(Date.now() - 10 * 60_000));
        await closeDatabase();
        const reopened = await initDatabase();
        assert.equal(await reopened.query(`SELECT count(*) AS count FROM "member_role_expirations" WHERE "role_id" = ${trial.id}`).then((rows) => Number(rows[0].count)), 1);
        assert.equal(await worker.expireTemporaryRoles(), 1, "expiries that passed while stopped are caught up");
        assert.deepEqual(await held().then((ids) => ids.filter((id) => id !== guild.id)), [event.id]);

        await Member.addRole(friend.id, guild.id, trial.id, { expires_at: new Date(Date.now() + 3600_000), assigned_by: owner.id });
        await Role.delete({ id: trial.id });
        assert.equal(await MemberRoleExpiration.countBy({ guild_id: guild.id }), 0, "deleting the role deletes its expiries");
        await Member.addRole(friend.id, guild.id, kept.id, { expires_at: new Date(Date.now() + 3600_000), assigned_by: owner.id });
        await Member.removeFromGuild(friend.id, guild.id);
        assert.equal(await MemberRoleExpiration.countBy({ guild_id: guild.id }), 0, "leaving the server deletes the member's expiries");
    } finally {
        await closeDatabase();
    }
});
