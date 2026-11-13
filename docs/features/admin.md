# Admin dashboard

The dashboard is at `/admin`. Operators see every page, and [setup.md](../self-hosting/setup.md#operator-account) explains how to grant the operator right. Other staff see only the pages, fields and buttons their rights allow. [admin-api-coverage.md](../development/admin-api-coverage.md) maps which API operations the dashboard covers.

## Pages

| Group            | Page                   | Needs             | What it controls                                                                                    |
| ---------------- | ---------------------- | ----------------- | --------------------------------------------------------------------------------------------------- |
| Instance         | Overview               | any staff right   | Counts and activity charts.                                                                         |
| Instance         | Site settings          | `OPERATOR`        | Instance configuration, see [Site settings](#site-settings).                                        |
| Instance         | Official inbox         | `OPERATOR`        | Direct messages to and from the official account.                                                   |
| Instance         | Announcements          | `OPERATOR`        | Encrypted announcements from the official account, see [announcements.md](announcements.md).        |
| Public pages     | Blog                   | `OPERATOR`        | Posts and categories on `/blog`, see [blog-and-help.md](blog-and-help.md).                          |
| Public pages     | Help centre            | `OPERATOR`        | Categories, sections and articles on `/support`, see [blog-and-help.md](blog-and-help.md).          |
| Public pages     | What's New             | `OPERATOR`        | Changelogs in the client's What's New window, see [whats-new.md](whats-new.md).                    |
| People & servers | Users & profiles       | `VIEW_USERS`      | Accounts, addresses and IP bans.                                                                    |
| People & servers | Instance invites       | `VIEW_USERS`      | Signup invites and invite trees, see [invites.md](invites.md).                                      |
| People & servers | Servers                | `MANAGE_GUILDS`   | Servers, their channels and roles.                                                                  |
| People & servers | Reports                | `VIEW_MODERATION` | Reports people sent from the client.                                                                |
| People & servers | Automod                | `VIEW_MODERATION` | Instance automod, see [automod.md](automod.md).                                                     |
| Staff            | Staff roles            | `MANAGE_STAFF`    | Staff roles and who holds them.                                                                     |
| Staff            | Audit log              | `VIEW_AUDIT_LOG`  | Every staff action.                                                                                 |
| Customization    | Shop & collectibles    | `OPERATOR`        | Shop packs and items. Every price is 0.                                                             |
| Customization    | Sticker packs          | `OPERATOR`        | The sticker packs every account gets.                                                               |
| Customization    | Profile badges         | `OPERATOR`        | Custom badges, which staff then give out from the user drawer.                                      |
| Customization    | Experiments            | `OPERATOR`        | Discord client experiments for some or all users, which take effect after a reload.                 |
| Customization    | Games                  | `OPERATOR`        | Games added to the built-in list people pick from.                                                  |
| Operations       | Performance            | `OPERATOR`        | This process's uptime, memory, event loop delay, database state, latency, errors and rate limiting. |
| Operations       | Status page            | `OPERATOR`        | Components, incidents and maintenance on the public `/status` page.                                 |
| Operations       | System & compatibility | `OPERATOR`        | The bundled client and its patch check, link previews, voice and the Shop catalog.                  |

Lists show 50 rows a page. The Users and Servers pages take a cursor, `after` in the admin API, and every other admin list refuses an `offset` past 10,000. The sidebar lists only the pages your rights open, and a link to any other page names the right it needs. Command+K or Ctrl+K searches pages, people, servers and IP addresses.

## Staff roles

A staff role is a named set of instance rights with a position, a color and a badge switch. An account's rights are its own `rights` plus the rights of every role it holds, and a role can never carry `OPERATOR`. The first start seeds these roles, which operators can rename, edit, reorder or delete on the Staff roles page:

| Role            | Position | Rights                                                                                                    | Badge |
| --------------- | -------- | --------------------------------------------------------------------------------------------------------- | ----- |
| Admin           | 4        | `MANAGE_USERS`, `MANAGE_GUILDS`, `MANAGE_MESSAGES`, `MANAGE_STAFF`, `VIEW_AUDIT_LOG` and everything below | Staff |
| Moderator       | 3        | `MODERATE_USERS`, `VIEW_MODERATION`, `VIEW_USERS`, `MANAGE_MESSAGES`                                      | Moderator Programs Alumni |
| Support         | 2        | `SUPPORT_USERS`, `VIEW_USERS`, `VIEW_MODERATION`, `RESEND_VERIFICATION_EMAIL`                             | Staff |
| Read-only audit | 1        | `VIEW_AUDIT_LOG`, `VIEW_MODERATION`                                                                       | none  |

| Right             | Allows                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| `MANAGE_USERS`    | Everything the next four rights allow, plus profile edits, account deletion, automod settings and instance invites. |
| `VIEW_USERS`      | Search and open accounts, and list addresses, badges, the shop catalog and instance invites.                  |
| `MODERATE_USERS`  | Violations, suspensions, disabling, IP bans, report decisions, automod actions, join requests and raids. Includes `VIEW_MODERATION`. |
| `VIEW_MODERATION` | Read reports, violations, IP bans and the Automod page.                                                       |
| `SUPPORT_USERS`   | Password reset links, turning off two-factor authentication, signing out sessions, marking an email verified. |
| `MANAGE_STAFF`    | Create, edit, reorder, delete and assign staff roles.                                                         |
| `VIEW_AUDIT_LOG`  | Read the audit log.                                                                                           |

Staff can't act on an account at or above their own level, which is their highest role position, and can't assign or move a role to it or above or give a role a right they don't have. They also can't open that account's page, sessions, two factor methods, invites, standing, staff roles, settings, widgets or pride badges, though the user search still lists it. Operators are above every role.

### Role badges

A role with the badge switch on gives its members a profile badge. Which badge depends on the role's rights:

- A moderator role holds `MODERATE_USERS` or `MANAGE_MESSAGES` and none of `MANAGE_USERS`, `MANAGE_GUILDS`, `MANAGE_STAFF`, `BYPASS_RATE_LIMITS`, `SEND_BACKDATED_EVENTS` or `CREATE_REGISTRATION_TOKENS`. Its members get Discord's Moderator Programs Alumni badge and the `CERTIFIED_MODERATOR` public flag (`1 << 18`), and no staff badge. The default Moderator role is one.
- Any other role gives the staff badge, named after the highest such role the member holds, for example "<instance name> Admin".

Someone with a moderator role and another badge role shows both: the staff badge from the other role and the alumni badge. The rule only looks at rights, so renaming a role doesn't change its badge, and the Staff roles page says which badge each role shows.

The alumni badge from a role is not stored on the account. Profiles add it while the person holds the role, and it goes away with the role. A Moderator Programs Alumni badge given by hand on the user's page stays when the role is removed, and the profile never shows it twice. The `CERTIFIED_MODERATOR` flag is on while the account has the badge from either source. Assigning or removing a role, editing a role's name, rights, position or badge switch, reordering roles, deleting a role, editing a user's badges and deleting the alumni badge all update the flag and send `USER_UPDATE` and a member update to clients, so open profiles refresh. Each API start runs the same check over every staff role member, every account with the flag and every account with the badge, so moderators from before this rule get the flag on the first start and nothing changes on later starts. Badges that come from raw account rights rather than roles are unchanged: an account whose own `rights` give it the admin panel still gets the stored staff badge.

## Audit log

The server logs every successful staff action, with the actor, the target, the action and the request body with secrets removed. The Audit log page filters by staff member, target, area, action and time, and the user drawer lists the staff actions taken on that account.

## Overview

The Overview page shows counts of accounts, servers, messages, people online and open reports, with their change against the previous period, and activity charts over 24 hours, 7, 30 or 90 days. The reports and automod charts need `VIEW_MODERATION`, and the upload charts need `OPERATOR`.

## Users

The Users page has tabs for accounts, IP addresses and IP bans, and can filter to suspended accounts, accounts waiting for approval and accounts with a join reason. The user drawer edits the account, its profile and cosmetics, rights, standing, violations, sessions, two-factor authentication, staff roles and invites, and each field needs the right listed above for it. The dashboard never shows password hashes, tokens, two-factor secrets, encryption keys or recovery codes.

### Badges

The user drawer's badge list gives and takes custom and preset badges. Its "Badge levels and rarity" card sets the Features badge, the levelled badges, per-badge rarity and The Void, a staff-only badge with 10 levels from Eclipse to Supernova. Pick a level to grant The Void or change its level, or "No Void badge" to take it away, then press Save badge levels or the drawer's Save. The card shows the current level's icon and the first grant date. Viewing the card needs `VIEW_USERS`, changing it needs `MANAGE_USERS`, and staff can't change an account at or above their own level. Each save writes a "Changed a profile customization" entry to the audit log, and a change to The Void lists the old and new level under `the_void`. See [badges.md](badges.md#the-void).

### Removing spam accounts

Select rows, or select the whole page and then every account that matches the search, up to the newest 5,000. The bar above the list then disables or deletes them. Disabling signs the accounts out and can also delete their messages, which needs `MANAGE_MESSAGES`. Deleting needs `MANAGE_USERS`, removes their messages, DMs and memberships, and hands each owned server to the member with the highest role. Your own account and accounts at or above your level are skipped.

## IP addresses and bans

The user drawer lists the address an account registered from and the last address of each session, with how many accounts share each one. The IP addresses tab lists addresses with the most accounts first, and opening one can remove all its accounts and ban the address. The IP bans tab lists and lifts bans.

- Registration from a banned address gets HTTP 403. Sign-in checks the address after the password, so staff can still sign in from it.
- A banned account that signs in from a new browser bans that browser one step further, and a spread ban expires after 7 days. Lifting a ban lifts the bans it spread.
- Address and browser bans never catch staff.
- Private, loopback and Cloudflare addresses, and your own address, can't be banned.

## Reports

The Reports page lists reports newest first, filtered by status or reported user. A second report about the same thing updates the open one, and message reports save the 15 messages before and the 10 after the reported one. The report drawer shows other open reports about the same message or user and can close them all. [e2ee.md](e2ee.md#reporting-encrypted-messages) covers reports from encrypted conversations.

## Servers

The server drawer edits a server's settings, levels, premium tier and feature flags, and its channels and roles within the instance limits. A server with the `INTERNAL_EMPLOYEE_ONLY` flag can only be joined through an invite by instance staff: operators, accounts with any staff right, members of any staff role and accounts with the staff badge flag.

The Members section lists members 50 at a time by user ID. Search matches an exact user ID or part of a username, display name or nickname. Opening a member sets their nickname and roles, times them out for 60 seconds to 28 days or ends a timeout, removes them from the server, or bans them and optionally deletes their messages from the last hour, day or 7 days. The Bans section lists bans the same way with the reason and who banned them, and lifts a ban. The Invites section creates an invite to a text, voice, announcement, stage or forum channel that expires after 30 minutes to 7 days or never and allows 1 to 100 uses or any number, lists every invite newest first with its uses, expiry and creator, and revokes invites. The vanity link stays in the server's own settings. The Emoji, stickers and sounds section lists up to 1,000 of each, renames an emoji with 2 to 32 letters, numbers or underscores, edits a sticker's name, description and tags, edits a soundboard sound's name, volume and emoji and plays it, and deletes any of them with its file. Emoji that an integration manages are read only. Uploading stays in the client. Each change writes a staff audit entry and an entry in the server's own audit log with the reason you give. Staff can't change members who are staff at or above their own level, can't time out or remove the server owner, and can't time out members whose roles grant Administrator, because Administrator ignores timeouts. Every route needs `MANAGE_GUILDS`.

## Shop and sticker packs

The Shop page manages custom packs and items, and renames, reorders or restyles mirrored packs, with Reset to restore the originals. Deleting a custom item removes it from every profile.

The Sticker packs page holds packs imported from Discord, as [setup.md](../self-hosting/setup.md#standard-stickers) describes, and packs made on the instance. Stickers are PNG, APNG, GIF, WebP or Lottie JSON files of up to 4 MiB with names of 2 to 30 characters. A pack holds up to 200 stickers and an instance up to 500 packs, and open clients pick up new and edited packs within an hour and hidden or deleted packs when they reload. Deleting a pack also removes its stickers from old messages, so hide a pack to retire it. While `externalRequests.discordStickerPacks` is on, an instance with no packs imports Discord's catalog again.

## Site settings

Site settings holds the instance configuration, and everything it doesn't show is in the configuration file described in [setup.md](../self-hosting/setup.md#configuration-file). [signup.md](signup.md), [invites.md](invites.md), [automod.md](automod.md), [homepage.md](homepage.md), [connections.md](connections.md) and [external-services.md](../self-hosting/external-services.md) describe their own settings.

The Connected accounts card turns each connection provider on or off, sets its client ID, secret and API key, and shows the callback URL to register with the provider. It reads `GET /api/v9/admin/connections` and saves with `PATCH /api/v9/admin/connections/<provider>`. Secrets are never sent back, only whether one is set.

The Client addresses card sets how the server finds a visitor's address for rate limits, bans and the address caps. Address header sets `security.forwardedFor`. Automatic, the blank value, and `X-Forwarded-For` both read `X-Forwarded-For` from trusted proxies and `CF-Connecting-IP` from Cloudflare. The other choices are `CF-Connecting-IP`, `True-Client-IP`, `X-Real-IP` and `Fly-Client-IP`. Trusted proxies sets `security.trustedProxies`, a comma separated list of addresses, CIDR ranges or the names `loopback`, `linklocal` and `uniquelocal`, which is all three names when blank and takes effect after a restart. Under Docker, `scripts/docker-configure.js` resets the header to `X-Forwarded-For` and the proxies to `TRUSTED_PROXIES` on every start, so set the proxies in `.env` there.

Server owners and administrators always skip slowmode. Members with Manage Messages, Manage Channels or Bypass Slowmode skip it too while `limits.channel.allowSlowmodeBypass` is on, which is the default. Turning it off holds them to slowmode like everyone else.
