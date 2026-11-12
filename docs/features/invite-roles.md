# Invite roles

An invite can give roles to everyone who joins through it. The client's invite dialog shows the role picker to members with Manage Roles, and sends the chosen roles as `role_ids` with `POST /channels/:channel_id/invites`.

- The creator needs Manage Roles, and every role must belong to the server, be below the creator's highest role unless they own the server, and not be `@everyone` or a managed role. Otherwise the request fails with Missing Permissions or Unknown Role. Up to 250 roles.
- The roles are stored on the invite in `invites.role_ids` and returned as `roles` (id, name, position, color, colors, icon, unicode_emoji) on the invite, in invite lists and when resolving the code.
- A new member who joins through the invite gets the roles that still exist and are not managed, in one `GUILD_MEMBER_UPDATE`. People who were already members get nothing.
