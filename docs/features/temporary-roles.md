# Temporary roles

A role can be given for a set time and the server takes it away again when the time is up, without a bot. Typical uses are Event Access for 24 hours, Trial Member for 7 days, Muted or Restricted until a date, and channel access for tournament players until the event ends. This is an instance feature. Discord has no expiry on role assignments.

## Who can do it

Giving a role temporarily, changing when it expires and making it permanent again need the same rights as giving the role at all: Manage Roles, and the role must be below your highest role unless you own the server. `@everyone` and managed roles can't be given, temporarily or otherwise. The server checks this with the same `authorizeMemberRoleChanges` that guards normal assignments.

An expiry lasts from 1 minute to 365 days. The server allows 5 seconds of clock skew at the short end and 1 minute at the long end.

## API

### Assign a role with an expiry

`PUT /guilds/:guild_id/members/:user_id/roles/:role_id` takes an optional JSON body with one of:

| Field              | Type                | Meaning                                       |
| ------------------ | ------------------- | --------------------------------------------- |
| `expires_at`       | ISO 8601 timestamp  | The role is removed at this time.             |
| `duration_seconds` | integer, 60 to 31536000 | The role is removed this many seconds from now. |

Sending both is a 400. The call still answers 204.

Without a body, or with both fields missing or `null`, the call works exactly as on Discord and gives the role permanently. If the member already had the role with an expiry, that expiry is cleared. Calling the route again with a new expiry replaces the old one, so the same call also extends or shortens a temporary role.

```sh
curl -X PUT "$API/guilds/$GUILD/members/$USER/roles/$ROLE" \
  -H "authorization: $TOKEN" -H "content-type: application/json" \
  -d '{"duration_seconds": 86400}'
```

### Change expiries in a member update

`PATCH /guilds/:guild_id/members/:user_id` takes an optional `role_expirations` object next to `roles`. Its keys are role IDs and each value is an ISO 8601 timestamp or `null`:

- A timestamp sets or replaces the expiry of that role.
- `null` makes the role permanent and leaves the role on the member.
- A role with a timestamp must be on the member after the update, either already or because it is in `roles` in the same request. Otherwise the request fails with `ROLE_NOT_ASSIGNED` on `role_expirations.<role_id>`.
- At most 250 entries.

Roles in `roles` that `role_expirations` doesn't mention keep their current expiry, and roles that are new get none. This matters because Discord's client sends the whole `roles` list every time it adds or removes one role, and that must not wipe the expiries of the other roles.

```json
{ "roles": ["1570854081835140121", "1570854081860305965"], "role_expirations": { "1570854081860305965": "2026-11-20T18:00:00.000Z" } }
```

### Read expiries

`GET /guilds/:guild_id/members/:user_id` and the `PATCH` response carry `role_expirations`, an object of role ID to ISO 8601 timestamp for the member's temporary roles. Anyone who can see the member can see it, as with `roles`. Members in READY, `GUILD_MEMBERS_CHUNK` and the member list don't carry it.

`GUILD_MEMBER_UPDATE` events from role assignment, role removal, member updates and expiry carry `role_expirations` too. Events from other changes, such as a nickname change, leave it out, and a client should not read a missing field as "no temporary roles".

`GET /guilds/:guild_id/role-expirations` lists the temporary roles in the server for members with Manage Roles, soonest first. It takes `user_id`, `role_id` and `limit` (1 to 1000, default 1000) in the query and returns:

```json
[
    {
        "guild_id": "1570853335748149426",
        "user_id": "1570853335274193000",
        "role_id": "1570854081835140121",
        "expires_at": "2026-11-13T17:34:38.547Z",
        "assigned_by": "1570853320392802405",
        "created_at": "2026-11-13T17:33:28.551Z"
    }
]
```

## Storage

Expiries are rows in `member_role_expirations`, one per member and role, keyed by `guild_id`, `user_id` and `role_id`. Besides `expires_at` a row keeps `assigned_by` and `created_at`. Its foreign keys delete it with the server, the role or the member, and a foreign key on `(member_index, role_id)` to `member_roles` deletes it as soon as the role leaves the member by any path: removing the role, a `PATCH` without it, onboarding, leaving the server or an admin tool. So an expiry can't outlive the assignment it belongs to and come back to remove a role that was later given permanently. `Member.removeRole` also deletes the row itself for databases built with `DB_SYNC`, which doesn't create that foreign key.

## Removing expired roles

`startTemporaryRoleExpirer` in `src/api/util/handlers/TemporaryRoles.ts` runs in every API process. It sweeps once as soon as the server starts, which catches up on everything that expired while the server was down, and then every 10 seconds, so a role goes within about 10 seconds of its expiry.

Each sweep takes up to 100 due rows at a time in one transaction. It deletes them with `DELETE ... RETURNING`, picking them with `FOR UPDATE SKIP LOCKED` on PostgreSQL, and deletes the matching `member_roles` rows in the same transaction. A row can only be deleted once, so when several API processes sweep at the same time each expiry is handled by exactly one of them. A sweep that starts while another one in the same process is still running joins it. After the commit the sweep sends `GUILD_MEMBER_UPDATE` for each member, as a manual removal does, and writes a `MEMBER_ROLE_UPDATE` audit log entry with the removed roles under `$remove` and the reason `Temporary role expired`. The entry's actor is whoever assigned the role, or the server owner when that account is gone.

## Audit log

Assigning a role with an expiry writes the usual `MEMBER_ROLE_UPDATE` entry with `$add`, and its reason ends with the role's expiry, for example `Event Access is temporary until 2026-11-13T17:34:38.547Z`. A reason sent in `X-Audit-Log-Reason` comes first and the expiry follows in brackets. Changing an expiry through `role_expirations` writes a `MEMBER_ROLE_UPDATE` entry whose reason lists each change, with `is permanent` for a `null`.

## Client

The `FosscordTemporaryRoles` plugin in `client/plugins/fosscordTemporaryRoles` adds the controls. It only shows them to people who could give that role: Manage Roles, a role below their highest role or ownership of the server, and not a managed role.

- The member context menu's Roles submenu ends with **Assign temporarily…**, a submenu of the roles you can give. A role that is already temporary shows when it expires under its name.
- The profile popout's add role button (+) opens Discord's role picker with an **Assign temporarily…** button under it. Turn it on and the role you pick opens the dialog instead of being added straight away.
- The dialog is titled **Assign role** and shows the role and the member, an **Expires** row with **1 day**, **7 days**, **30 days** and **Custom**, where Custom opens a date and time field, an **Automatically remove role** row showing **Enabled** and an **Assign role** button. Presets send `duration_seconds`, Custom sends `expires_at`.
- A temporary role's pill in the profile and popout has a small clock. Its tooltip says when the role goes, for example `Expires in 3 days, on Nov 16, 2026, 6:31 PM`. For people who can manage the role the clock is a button that opens the dialog as **Change role expiry**, where **Save** sets a new time and **Keep the role permanently** sends `role_expirations: { [role_id]: null }`.

The plugin reads expiries from `GET /guilds/:guild_id/members/:user_id` when a profile shows the member's roles and keeps them for 5 minutes. It patches the client's gateway handler to pass `role_expirations` from `GUILD_MEMBER_UPDATE` into the dispatched action, so pills update as soon as an expiry is set, changed or reached. When an update arrives without the field, the plugin drops what it had for that member and reads it again on the next render.

## Testing

`scripts/tests/temporary-roles.test.cjs` runs the expiry worker against a fresh SQLite database: a due role is removed once even with two sweeps at once, the removal sends `GUILD_MEMBER_UPDATE` and writes the audit entry, saving other role changes keeps expiries, removing the role, a permanent assignment, deleting the role and leaving the server delete the expiry, and a role that expired while the database was closed is removed by the first sweep after it reopens. `scripts/tests/member-role-authorization.test.cjs` covers the validation limits and that temporary assignments and `role_expirations` go through the same hierarchy checks as normal ones before anything is written.
