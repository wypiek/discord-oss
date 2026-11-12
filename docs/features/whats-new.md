# What's New

The client's What's New window shows changelogs that operators write in the admin dashboard, under Public pages, What's New. The window shows the newest published one, and when "Show on startup" is on it opens by itself once for everyone who hasn't seen it yet.

## Writing a changelog

Each changelog has:

| Field | Meaning |
| --- | --- |
| Title | Only shown in the dashboard. Put the heading people see in the body. |
| Date | Shown in the window. A changelog with a later date stays hidden until that day, in UTC. |
| Image or YouTube video | Optional media at the top of the window. The image is uploaded like a blog image. The video takes a YouTube link or an 11-character video id. A changelog can't have both. |
| Body | Markdown. `{instance}` is replaced with the instance name. |
| Published | Drafts never reach the client. |
| Show on startup | Opens the window by itself when this is the newest published changelog. |

The newest published changelog is the one with the latest date, and the newest of those when several share a date. Unpublishing or deleting a changelog takes it out of What's New within a minute, which is how long the CDN caches the list.

## How the client loads it

The `FosscordCore` plugin points the client's changelog requests at the instance's CDN. `GET /changelogs/config_<platform>.json` lists the published changelogs, each with a `min_version` that goes up by one from the oldest to the newest, because the client opens the one with the highest `min_version`. `GET /changelogs/<platform>/<id>/<locale>.json` returns one changelog with `date`, `content`, `locale`, `asset` and `asset_type`, where `asset_type` is `0` for a YouTube video and `1` for an image. Every locale gets the same text. The plugin also points the window's link to Discord's product blog at the instance's own `/blog`.

The admin API is `GET` and `POST /api/v9/admin/changelogs` and `GET`, `PATCH` and `DELETE /api/v9/admin/changelogs/:id`, all needing `OPERATOR`.
