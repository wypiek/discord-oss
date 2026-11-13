# Spotify and SoundCloud presence

When you listen on Spotify or SoundCloud, your profile and the member list show it as a Listening activity, like Discord's own Spotify presence. Spotify works in two ways: through a connected Spotify account, which the stock client handles, and through the desktop app reading the Spotify app. SoundCloud works through the desktop app.

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

## The desktop app

The [desktop app](desktop.md) reads what plays in SoundCloud and Spotify and hands it to the FosscordMusicPresence plugin through `window.DiscordOSS.music`. It only reads while the plugin asks for a source, so with both sources off it runs nothing.

| Source | macOS | Windows | Linux |
| --- | --- | --- | --- |
| SoundCloud | The SoundCloud window | The SoundCloud window | The SoundCloud window, and any MPRIS player whose `xesam:url` is on soundcloud.com |
| Spotify | The Spotify app through AppleScript | The Spotify app through Windows media sessions | The Spotify app through MPRIS |

- The SoundCloud window opens from File > Open SoundCloud, the tray menu, or the Open SoundCloud button in the plugin's settings. It loads soundcloud.com in its own sandboxed session, `persist:soundcloud`, so its login stays separate from the instance. A preload script reads the player bar once a second: the title, artist, track link, artwork, elapsed time, length and the play button's state, with the page's media session as a fallback for title, artist and artwork. It sends an update when the track or the play state changes, when the position jumps by more than 3 seconds, and every 30 seconds otherwise. The window grants no permissions except fullscreen, and links that leave soundcloud.com or its Google, Apple and Facebook sign-in pages open in the browser. Closing the window stops the music and clears the activity. SoundCloud Go+ tracks that need DRM only play their preview, because the app has no Widevine.
- macOS: every 5 seconds the app checks for a process named Spotify with `pgrep`, and only then asks Spotify for its state with `osascript`. The first time, macOS asks whether the app may control Spotify. If that is denied, the app stops asking until it restarts. macOS 15.4 and later don't let other apps read the system's Now Playing information, so SoundCloud playing in a browser can't be seen.
- Windows: one hidden PowerShell process reads the system media sessions every 3 seconds and reports sessions whose app id contains Spotify. It exits when the app does. Windows doesn't expose the track link or an artwork URL, so this activity has no album art and no button.
- Linux: every 5 seconds the app lists the MPRIS players on the session bus with `busctl` and reads up to 8 of them. Spotify always reports position 0 over MPRIS, so the activity starts from the moment the track was first seen.

## The activity

The plugin turns a playing track into a Listening activity. When SoundCloud and Spotify both play, SoundCloud wins. A paused track clears the activity.

| Field | SoundCloud | Spotify from the desktop app |
| --- | --- | --- |
| `name` | SoundCloud | Spotify |
| `application_id` | `1440106212185735168` | `1440106212185735169` |
| `details` and `state` | Track title and artist | Track title and artists |
| `assets.large_image` | `mp:external/...` from the artwork URL | `spotify:<image id>` |
| `timestamps` | Start and end from the position and length | Same |
| Button | Listen on SoundCloud, to the track | Play on Spotify, to the track |

The Spotify source only runs when the account has no Spotify connection and the stock Spotify activity is absent, so a connected account's activity, its Display Spotify as your status setting and Listen Along stay in charge. Without the desktop app, in a browser, the plugin's desktop sources do nothing.

The client only publishes a Listening activity that has an `application_id` when Share your activity is on, and not while you are invisible. The plugin's settings have one switch per source, SoundCloud and Spotify, both on.

## External images

`POST /applications/:id/external-assets` with `{ "urls": [...] }` answers `[{ "url", "external_asset_path" }]`, Discord's endpoint for activity images on other hosts. It takes 1 to 10 `http` or `https` URLs of up to 900 characters without credentials, and returns signed `external/<signature>/https/<host>/<path>` paths. The client stores them as `mp:external/...` and loads them from the instance's `/external` media proxy, which only passes images, video and audio. Any application id works, since the path is signed by the server and not tied to an application.

## Activities for other users

The current client hides any activity whose `content_classification` isn't marked as loaded. The server sets `content_classification: { "loaded": true }` on every activity it stores, so other people's clients show it.
