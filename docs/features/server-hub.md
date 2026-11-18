# Server Hub

Server Hub is a page at the top of a server's channel list where everyone can see what is happening in the server. It has a banner with the server's name, online count, member count and boosts, and a two column board of widgets that the server's managers arrange. The client calls it a guild space.

The client draws the whole page. The server turns it on, stores the layout and computes the data the widgets show.

## Turning it on

The page is behind Discord's `2026-09-guild-spaces` guild experiment. Every server gets variant 1, which turns it on, from `src/util/util/ApexExperiments.ts`. The client only applies a guild experiment when the user's own experiment list marks the same experiment as eligible, flag 8, so `getApexExperiments` adds that entry to every user for each default guild experiment and for each one an operator grants in `client.guildExperiments`. Guild experiments reach the client in READY and, through `ReadyGuildDTO`, in the `GUILD_CREATE` sent when someone creates or joins a server.

Each guild carries `guild_space_settings`, `{ enabled, publish_status }`. A new server has the hub enabled and unpublished (`publish_status` 0). Members with Manage Server see it and can edit it, and everyone else sees it once it is published (`publish_status` 1). Managers publish from the bar at the top of the page or when they save the first time, and turn the hub off under Server Settings > Engagement, which also unpublishes it. Each change sends `GUILD_UPDATE`.

## Widgets

| Widget | Instances | Data |
| --- | --- | --- |
| Gaming Leaderboard | 1 | Weekly ranking of members by game time, see below. |
| Popular Games | 1 | The 10 games the most members played in the last 7 days, each with its cover, player count and players. |
| Whiteboard | 1 | The built-in Whiteboard activity, drawn inside the page. |
| Image and Text | 3 | A title of up to 100 characters, text of up to 500 characters and an image of up to 10 MB. |

Every widget is free and unlocked. A new hub shows the leaderboard and the whiteboard in the left column and popular games in the right one. The editor adds, removes, moves and configures widgets and changes the banner image, and the layout is saved in one `PUT`. Discord's Popular Music widget is not offered.

## Game time

Once a minute the gateway credits every connected user who is playing a game with 60 seconds, the same sample that feeds the Game Time badge (see [badges.md](badges.md)). Each sample also adds the seconds to a row in `game_play_days` for the user, the UTC day and the game. A game is its application id, or `name:<lowercase name>` when the activity has none. Rows older than 16 days are deleted the first time a sample is recorded on a new day.

Only users who turned on "Use data to personalise my Discord experience" are recorded. When a widget is computed, a member is left out when that setting is off, when Display current activity is off, or when they turned off activity sharing for that server. The page's Open Settings buttons open the client's Activity Sharing dialog for those settings. Name-only games are matched to the detectable games list by name and alias, and games the instance can't resolve to an application count towards totals but are not listed.

## Leaderboard

Weeks start on Monday at 00:00 UTC. The stat rotates every week between days played, hours played and different games played, and the header names it ("Most Game Days") with the days left. Members are ranked by the stat, then by total time. The response has the top 50 and the requesting member's own entry, with up to 5 recently played games per member. On the seventh day of the week the client shows the top three on a podium. The client shows the leaderboard once 3 members are on it and popular games once 3 members have played.

Results are cached for 60 seconds per server.

## Whiteboard

Each server with a whiteboard widget gets a hidden channel of type 20 (`GUILD_SPACE`) named `server-hub`, created the first time the hub is loaded. The client doesn't list it, and `POST /guilds/:id/channels` refuses to create one. The whiteboard runs in that channel without a voice connection: the launch is tied to the client's gateway session and ends when the gateway session closes. Members need Use Activities in the channel, and the widget's settings restrict it to roles.

The client looks for Discord's own whiteboard application, `1070087967294631976`. The FosscordServerHub plugin points it at the instance's built-in Whiteboard activity, whose id the server sets as `GLOBAL_ENV.WHITEBOARD_APPLICATION_ID`. A hub's board is kept by channel instead of by activity instance, saved to `whiteboard_boards` 5 seconds after the last change and when the last person leaves, and loaded again on the next launch. Boards started from voice channels and DMs still disappear when the activity ends.

## Images

The banner is stored at `guild-space/<guild>/banner/<hash>`, the same place Discord keeps it, and an Image and Text widget's image at `guild-space/<guild>/image-text-widget/<widget>/<hash>`. Replaced and removed images go to the image deletion queue, and the sweeper keeps any file a guild still points at.

## API

| Request | Who | Does |
| --- | --- | --- |
| `GET /guilds/:id/space` | Members who can see the hub | The banner hash, the whiteboard channel and the widgets. 404 when the hub is off or unpublished for the caller. |
| `PUT /guilds/:id/space` | Manage Server | Saves `{ header: { custom_banner }, widgets }`. Widgets keep their id. Errors are keyed `widgets.<index>`. |
| `GET /guilds/:id/space/widgets/catalog` | Manage Server | The widgets that can be added. |
| `GET /guilds/:id/space/widgets/hydrate?widget_ids=` | Members who can see the hub | Leaderboard and popular games data. |
| `GET`, `PATCH /guilds/:id/space/settings` | Manage Server | `enabled` and `publish_status`. |

`PORT=<port> bun scripts/dev/parity-probe.mjs "server hub"` runs the API checks.

## Not done

- Popular Music, which needs a record of what members listen to.
- The weekly leaderboard result messages in the system channel. The toggle for them is saved, but no message is sent.
- When the client first opens the hub for a manager, the welcome dialog waits behind Discord's other tips and is skipped for accounts younger than Discord's new user period.
