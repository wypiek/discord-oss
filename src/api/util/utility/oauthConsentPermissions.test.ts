import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { Request, Response } from "express";
import { FindManyOptions } from "typeorm";
import { Application, ApplicationAuthorization, Member, Role, User } from "@spacebar/database";
import { Permissions } from "@spacebar/util";
import router from "../../routes/oauth2/authorize";

const userId = "100000000000000001";
const applicationId = "100000000000000002";
const getConsent = router.stack.find((layer) => layer.route?.stack.some((handler) => handler.method === "get"))!.route!.stack.at(-1)!.handle;

afterEach(() => mock.restoreAll());

async function consent(members: Member[], defaultRoles: Role[]) {
    mock.method(Application, "findOne", async () => Object.assign(new Application(), { id: applicationId, redirect_uris: [] }));
    mock.method(ApplicationAuthorization, "findOne", async () => null);
    mock.method(User, "findOneOrFail", async () => Object.assign(new User(), { id: userId, username: "Member" }));
    const memberQuery = mock.method(Member, "find", async (options: FindManyOptions<Member>) => {
        assert.equal((options.select as { roles: { permissions: boolean } }).roles.permissions, true, "permission bits must survive the role projection");
        return members;
    });
    const roleQuery = mock.method(Role, "find", async (options: FindManyOptions<Role>) => {
        const ids = (options.where as unknown as { id: { value: string[] } }).id.value;
        assert.deepEqual(ids, [...new Set(members.map((member) => member.guild.id))]);
        assert.deepEqual(options.select, { id: true, permissions: true });
        return defaultRoles;
    });
    let response: { guilds: { id: string; permissions: string }[] } | undefined;
    await getConsent(
        {
            query: { client_id: applicationId, scope: "identify" },
            user_id: userId,
        } as unknown as Request,
        { json: (value: typeof response) => (response = value) } as unknown as Response,
        () => assert.fail("unexpected next()"),
    );
    assert.equal(memberQuery.mock.callCount(), 1);
    assert.equal(roleQuery.mock.callCount(), members.length ? 1 : 0, "default roles must be fetched in one batch");
    return response!.guilds;
}

function member(guildId: string, roles: Role[] = [], ownerId = "other") {
    return Object.assign(new Member(), {
        id: userId,
        guild: { id: guildId, owner_id: ownerId, name: guildId },
        roles,
        user: { flags: 0 },
        communication_disabled_until: null,
    });
}

function role(id: string, permissions: bigint) {
    return Object.assign(new Role(), { id, permissions: permissions.toString() });
}

test("OAuth consent includes default and assigned permissions for ordinary members in a single batch", async () => {
    const view = Permissions.FLAGS.VIEW_CHANNEL;
    const manage = Permissions.FLAGS.MANAGE_GUILD;
    const guilds = await consent(
        [member("200000000000000001"), member("200000000000000002", [role("300000000000000001", manage)])],
        [role("200000000000000001", view), role("200000000000000002", view)],
    );
    assert.equal(guilds[0].permissions, view.toString());
    assert.equal(guilds[1].permissions, (view | manage).toString());
});

test("OAuth consent preserves administrator and owner access", async () => {
    const guilds = await consent(
        [member("200000000000000001", [role("300000000000000001", Permissions.FLAGS.ADMINISTRATOR)]), member("200000000000000002", [], userId)],
        [role("200000000000000001", Permissions.FLAGS.VIEW_CHANNEL), role("200000000000000002", Permissions.FLAGS.VIEW_CHANNEL)],
    );
    assert.equal(new Permissions(guilds[0].permissions).has("MANAGE_GUILD"), true);
    assert.equal(guilds[1].permissions, new Permissions(Permissions.ALL).bitfield.toString());
});

test("OAuth consent tolerates an absent default role and skips role lookup when there are no memberships", async () => {
    assert.deepEqual(await consent([], []), []);
    mock.restoreAll();
    const guilds = await consent([member("200000000000000001", [role("300000000000000001", Permissions.FLAGS.MANAGE_GUILD)])], []);
    assert.equal(guilds[0].permissions, Permissions.FLAGS.MANAGE_GUILD.toString());
});
