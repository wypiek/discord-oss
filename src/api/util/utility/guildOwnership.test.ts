import assert from "node:assert/strict";
import { afterEach, beforeEach, test, mock } from "node:test";
import { Request, Response } from "express";
import { EntityManager } from "typeorm";
import { AuditLog, Guild, Member } from "@spacebar/database";
import { getAjv } from "@spacebar/schemas";
import { ApiError, Permissions, Rights } from "@spacebar/util";
import * as rights from "@spacebar/util/util/Rights";
import * as permissions from "@spacebar/util/util/Permissions";
import * as events from "@spacebar/util/util/ipc/Event";
import router from "../../routes/guilds/#guild_id";

const guildId = "100000000000000001";
const ownerId = "100000000000000002";
const recipientId = "100000000000000003";
const otherId = "100000000000000004";
const patch = router.stack.find((layer) => layer.route?.stack.some((handler) => handler.method === "patch"))!.route!.stack.at(-1)!.handle;
const validate = getAjv().getSchema("GuildUpdateSchema")!;

let guild: Guild;
let currentOwner: string;
let memberExists: boolean;
let memberIsBot: boolean;
let memberStillExists: boolean;
let saved: boolean;
let response: Record<string, unknown>;
let auditEntries: Parameters<typeof AuditLog.log>[0][];
let emitted: Parameters<typeof events.emitEvent>[0][];

beforeEach(() => {
    currentOwner = ownerId;
    memberExists = memberStillExists = true;
    memberIsBot = saved = false;
    response = {};
    auditEntries = [];
    emitted = [];
    guild = Object.assign(new Guild(), {
        id: guildId,
        owner_id: ownerId,
        name: "Original",
        features: [],
        channel_ordering: [],
    });
    mock.method(guild, "toJSON", () => ({
        id: guild.id,
        owner_id: guild.owner_id,
        name: guild.name,
    }));
    mock.method(Guild, "findOneOrFail", async () => guild);
    mock.method(Member, "findOne", async (options: { where: { guild_id: string; id: string } }) => {
        assert.deepEqual(options.where, { guild_id: guildId, id: recipientId });
        return memberExists ? { id: recipientId, user: { bot: memberIsBot } } : null;
    });
    const manager = {
        findOneOrFail: async () => ({ id: guildId, owner_id: currentOwner }),
        findOne: async () => (memberStillExists ? { id: recipientId } : null),
        save: async () => {
            saved = true;
        },
    };
    mock.method(Guild, "getRepository", () => ({
        manager: {
            transaction: async (callback: (manager: EntityManager) => Promise<void>) => callback(manager as unknown as EntityManager),
        },
    }));
    mock.method(rights, "getRights", async () => new Rights("MANAGE_GUILDS"));
    mock.method(permissions, "getPermission", async () => new Permissions("MANAGE_GUILD"));
    mock.method(AuditLog, "log", async (entry: Parameters<typeof AuditLog.log>[0]) => {
        assert.equal(saved, true, "audit entry must follow successful persistence");
        auditEntries.push(entry);
    });
    mock.method(events, "emitEvent", async (event: Parameters<typeof events.emitEvent>[0]) => {
        assert.equal(saved, true, "gateway update must follow successful persistence");
        emitted.push(event);
    });
});

afterEach(() => mock.restoreAll());

async function update(body: Record<string, unknown>, userId = ownerId) {
    assert.equal(validate(body), true, JSON.stringify(validate.errors));
    await patch(
        { body, user_id: userId, params: { guild_id: guildId }, headers: {} } as unknown as Request,
        { json: (data: Record<string, unknown>) => (response = data) } as unknown as Response,
        () => assert.fail("unexpected next()"),
    );
}

test("accepts the client's ownership-only payload and reports the new owner", async () => {
    await update({ owner_id: recipientId });
    assert.equal(saved, true);
    assert.equal(guild.owner_id, recipientId);
    assert.equal(response.owner_id, recipientId);
    const audit = auditEntries[0];
    assert.deepEqual(audit.changes, [{ key: "owner_id", old_value: ownerId, new_value: recipientId }]);
    const event = emitted[0];
    assert.equal(event.event, "GUILD_UPDATE");
    assert.equal(event.data.owner_id, recipientId);
});

test("rejects ownership changes by managers, even with instance management rights", async () => {
    await assert.rejects(update({ owner_id: recipientId }, otherId), (error: ApiError) => error.code === 50013);
    assert.equal(saved, false);
});

test("rejects a recipient who is not a member of this guild", async () => {
    memberExists = false;
    await assert.rejects(update({ owner_id: recipientId }), (error: ApiError) => error.code === 10007);
    assert.equal(saved, false);
});

test("rejects bot recipients", async () => {
    memberIsBot = true;
    await assert.rejects(update({ owner_id: recipientId }));
    assert.equal(saved, false);
});

test("rejects a competing transfer once the actor is no longer the owner", async () => {
    currentOwner = otherId;
    await assert.rejects(update({ owner_id: recipientId }), (error: ApiError) => error.code === 50013);
    assert.equal(saved, false);
    assert.equal(emitted.length, 0);
    assert.equal(auditEntries.length, 0);
});

test("rejects a recipient who left before the transfer was saved", async () => {
    memberStillExists = false;
    await assert.rejects(update({ owner_id: recipientId }), (error: ApiError) => error.code === 10007);
    assert.equal(saved, false);
});

test("ordinary settings edits preserve a concurrently transferred owner", async () => {
    currentOwner = otherId;
    await update({ name: "Renamed" });
    assert.equal(response.name, "Renamed");
    assert.equal(response.owner_id, otherId);
    const audit = auditEntries[0];
    assert.deepEqual(audit.changes, [{ key: "name", old_value: "Original", new_value: "Renamed" }]);
});

test("rejects malformed owner IDs at schema validation", () => {
    for (const owner_id of [null, "", "abc", "-1", "1.5", "123456789012345678901", {}, []]) {
        assert.equal(validate({ owner_id }), false, `accepted ${JSON.stringify(owner_id)}`);
    }
    assert.equal(validate({ name: "Ordinary edit" }), true);
});
