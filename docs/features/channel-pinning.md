# Channel pinning

Right clicking a channel in a server's channel list shows Pin Channel to Top. A pinned channel moves into a Pinned Channels section above the server's categories and leaves its category, and Unpin Channel in the same menu puts it back. Threads and categories have no such item. It works in every server, Community or not.

## How it works

Pinning is personal. The client calls it "favorite" internally, and its own text says "Pinning is only for you, but channel order applies to everyone." Other members see the channel list unchanged, and nobody needs a permission to pin.

A pin is bit `1 << 11` (2048), `FAVORITED`, in the `flags` of the channel's override in the user's guild settings. When a channel isn't opted in yet the client also sets `1 << 12` (4096), `OPT_IN_ENABLED`, so pinning sends `flags: 6144` and unpinning sends `flags: 4096`. The client saves it with the bulk route:

```http
PATCH /api/v9/users/@me/guilds/settings
{"guilds": {"<guild id>": {"channel_overrides": {"<channel id>": {"flags": 6144}}}}}
```

`PATCH /users/@me/guilds/:guild_id/settings` accepts the same `channel_overrides`. Either route stores the override on the member's settings, answers with the updated settings and sends `USER_GUILD_SETTINGS_UPDATE` to the user's other sessions, so a pin or unpin shows up in another open tab at once. READY carries the overrides in `user_guild_settings`, so pins survive a reload. The client builds the Pinned Channels section from every override with `FAVORITED` whose channel belongs to that server.

Both routes reject an override for a channel outside the server with `10003 Unknown Channel`, and for DM settings (`null` or `@me` as the guild) an override for a channel the user isn't a recipient of. The bulk route checks every server in the request first, so a rejected request changes nothing.

## Community check

The client build in `assets/cache` doesn't gate pinning on a guild feature, an experiment or Community. The only Community check near it belongs to opt-in channels, the Channels & Roles and Browse Channels view, which still needs `COMMUNITY`. Dragging a pinned channel to reorder it opens a dialog that asks the user to unpin it first, since the order of the other channels is shared.
