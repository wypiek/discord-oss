# Spotify and Last.fm presence

When you listen to music, your profile and the member list show it as a Listening activity, like Discord's own Spotify presence. Spotify works in two ways: through a connected Spotify account, which the stock client handles, and through the desktop app reading the Spotify app. Last.fm works through a connected Last.fm account in any client.

## Spotify through a connected account

This is the client's own Spotify integration. Once the operator sets up Spotify, a user connects Spotify under Connections, and while they listen the client sends a Listening activity named Spotify with the track, the artists, the album art, the timestamps, `sync_id` and a `spotify:<user id>` party, so friends get the album art and Listen Along.

### Operator setup

1. Create an app in the [Spotify developer dashboard](https://developer.spotify.com/dashboard) with the Web API.
2. Add `<general.frontPage>/connections/spotify/callback` as its redirect URI. Spotify only accepts `https` addresses, and `http://127.0.0.1` for local testing.
3. Set `spotify_clientId`, `spotify_clientSecret` and `spotify_enabled` (`true`) in the `connection_config` table, then restart the server.

A Spotify app in development mode only works for the accounts listed under its User Management, and Spotify can require the app owner to have Premium. Opening it to everyone needs Spotify's extended quota.

### What the server does

- The authorize URL asks for `user-read-private`, `user-read-playback-state`, `user-read-currently-playing` and `user-modify-playback-state`. The last one is what Listen Along and Play on Spotify use.
- A new Spotify connection starts with Display on profile and Display Spotify as your status turned on, as on Discord. Reconnecting an account that is already connected stores the new tokens and clears a revoked flag.
- `GET /users/@me/connections` returns the access token only while it is valid for at least another minute. Without one, the client calls `GET /users/@me/connections/spotify/:id/access-token`, which refreshes the token with Spotify when it has expired and returns it. Parallel refreshes for one account share one request to Spotify, and the refresh token is kept when Spotify leaves it out of the response. When Spotify answers `invalid_grant`, the connection is marked revoked and the endpoint returns error 40012, which makes the client drop the account. The server never logs tokens, only the status of a failed request.
- The gateway stores and forwards the activity as the client sends it, including `sync_id`, `party`, `metadata` and `flags`. The client turns `spotify:<image id>` into `https://i.scdn.co/image/<image id>` itself.

### Keeping the track current

The stock client asks Spotify for the player state once when it connects, then waits for track changes on Spotify's dealer websocket. Those changes only arrive after a `PUT /me/notifications/player` call that Spotify allows for Discord's partner app alone, so with an instance's own Spotify app the activity would stay on the first track and disappear when it ends. The FosscordMusicPresence plugin calls the client's own player state function for every connected Spotify account every 15 seconds, so the activity follows track changes, pauses and skips. The client then handles the response exactly as it handles Spotify's push messages. The Check a connected Spotify account's player every 15 seconds setting turns this off.

## Last.fm through a connected account

Last.fm records what you play in almost any player, so linking it shows your music as a Listening activity in the browser, the desktop app and the Android app, with no player of our own.

### Operator setup

1. Create an API account at [last.fm/api/account/create](https://www.last.fm/api/account/create). The callback URL there doesn't matter, because the server sends its own.
2. In the admin dashboard, Site settings, Connected accounts, paste the API key and the shared secret into Last.fm and turn it on.

### Linking

1. The person picks Last.fm under Connections. Discord's client has no Last.fm entry, so the FosscordConnections plugin adds one with an icon from `/assets/connections/lastfm.svg` and a profile link to `https://www.last.fm/user/<name>`.
2. `GET /api/v9/connections/lastfm/authorize` returns `https://www.last.fm/api/auth/` with the API key and a `cb` of `<origin>/connections/lastfm/callback?state=<state>`.
3. After the person allows access, Last.fm sends the popup to the callback with `&token=<token>`. The client's callback page only reads `code`, so the plugin makes it fall back to `token`.
4. The server calls `auth.getSession` with the token and an `api_sig`, the MD5 of the sorted parameters followed by the shared secret. It stores the Last.fm username as the connection's id and name with Display on profile turned on, and keeps no session key.

### The activity

`GET /users/@me/connections/lastfm/<name>/now-playing` answers `{ "track": null }` or a track with `title`, `artist`, `album`, `url`, `artwork_url`, `duration_ms` when Last.fm knows it, `since` and `elapsed_ms`. The server reads `user.getRecentTracks` with `limit=1` and only counts the first track when Last.fm marks it `nowplaying`. It reads the length once per track from `track.getInfo`. Answers are cached for 10 seconds per user, so several tabs cost one Last.fm call. `since` is when the server first saw the track playing for that user, because Last.fm doesn't report the position. Artwork is kept only from Last.fm's image hosts and without Last.fm's blank placeholder. Failures answer no track and log only the HTTP status.

FosscordMusicPresence polls this every 15 seconds while the account has a Last.fm connection and shows the track as a Listening activity named Last.fm. A Spotify activity, from a connected account or the desktop app, wins over Last.fm, since Last.fm usually scrobbles the same track.

## The desktop app

The [desktop app](desktop.md) reads what plays in the Spotify app and hands it to the FosscordMusicPresence plugin through `window.DiscordOSS.music`. It only reads while the plugin asks for Spotify, so with that setting off it runs nothing.

- macOS: every 5 seconds the app checks for a process named Spotify with `pgrep`, and only then asks Spotify for its state with `osascript`. The first time, macOS asks whether the app may control Spotify. If that is denied, the app stops asking until it restarts.
- Windows: one hidden PowerShell process reads the system media sessions every 3 seconds and reports sessions whose app id contains Spotify. It exits when the app does. Windows doesn't expose the track link or an artwork URL, so this activity has no album art and no button.
- Linux: every 5 seconds the app lists the MPRIS players on the session bus with `busctl` and reads up to 8 Spotify players. Spotify always reports position 0 over MPRIS, so the activity starts from the moment the track was first seen.

## The activity

The plugin turns a playing track into a Listening activity. A paused track clears the activity.

| Field | Last.fm | Spotify from the desktop app |
| --- | --- | --- |
| `name` | Last.fm | Spotify |
| `application_id` | `1440106212185735170` | `1440106212185735169` |
| `details` and `state` | Track title and artist | Track title and artists |
| `assets.large_image` | `mp:external/...` from the artwork URL | `spotify:<image id>` |
| `timestamps` | Start from when the track was first seen, and an end when the length is known | Start and end from the position and length |
| Button | View on Last.fm, to the track | Play on Spotify, to the track |

The desktop Spotify source only runs when the account has no Spotify connection and the stock Spotify activity is absent, so a connected account's activity, its Display Spotify as your status setting and Listen Along stay in charge.

The client only publishes a Listening activity that has an `application_id` when Share your activity is on, and not while you are invisible. The plugin's settings have one switch per source, Last.fm and Spotify, both on.

READY includes the account's connected accounts, the same list `GET /users/@me/connections` returns, so the Spotify integration and the Last.fm source start right after the client loads.

## External images

`POST /applications/:id/external-assets` with `{ "urls": [...] }` answers `[{ "url", "external_asset_path" }]`, Discord's endpoint for activity images on other hosts. It takes 1 to 10 `http` or `https` URLs of up to 900 characters without credentials, and returns signed `external/<signature>/https/<host>/<path>` paths. The client stores them as `mp:external/...` and loads them from the instance's `/external` media proxy, which only passes images, video and audio. Any application id works, since the path is signed by the server and not tied to an application.

## Activities for other users

The current client hides any activity whose `content_classification` isn't marked as loaded. The server sets `content_classification: { "loaded": true }` on every activity it stores, so other people's clients show it.
