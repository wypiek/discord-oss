# External services

This page lists every outside host the instance contacts and the switch for each.

## Switches

The External requests card on the Site settings page of the admin dashboard edits `externalRequests`:

| Key | Default | Allows |
| --- | --- | --- |
| `discordDecorations` | on | Avatar decorations, nameplates and profile effects from Discord's CDN. |
| `discordAssetFallback` | on | Other missing Discord CDN assets, such as client images and Krisp noise suppression models. |
| `discordClientAssets` | on | Web client files missing from the cache. |
| `discordGames` | on | Refreshing the detectable games list. |
| `discordTemplates` | on | Importing server templates from Discord. |
| `discordStickerPacks` | on | Importing standard sticker packs and their artwork. |
| `discordBadDomains` | on | Discord's blocked-domain list. |
| `steamAssetFallback` | on | Art of the Steam avatar frames in the Shop, from `shared.fastly.steamstatic.com` through `PUBLIC_FETCH_PROXY`. |
| `thirdParty` | off | Link previews, embed media, IP reputation, connected accounts and Web Push, each of which also needs its own configuration. |

## Services

| Service | Used for | When |
| --- | --- | --- |
| Discord's site and CDN | The web client at setup and updates, and the switches above. Browsers never contact it. | Setup, then per switch. |
| Steam's CDN, `shared.fastly.steamstatic.com` | Art of the Steam avatar frames, through `PUBLIC_FETCH_PROXY`. Browsers never contact it. | `steamAssetFallback` on and someone views a frame that isn't cached. |
| Klipy | GIF search, the default provider. | GIF search on and a key from [Klipy's partner panel](https://partner.klipy.com) entered. |
| Tenor | The other GIF provider, with a public key. Google retired its API on June 30, 2026, so it can stop answering. | GIF search on. |
| `cors.estrogen.delivery` | Fetching link preview pages and serving embed media to clients. It sees every destination URL. | `thirdParty` on. |
| FixTweet, `api.fxtwitter.com` | X and Twitter post previews. | `thirdParty` on and no `external.twitter` token. |
| Linked websites | Link previews, YouTube, Vimeo and Dailymotion players, and domain verification. | `thirdParty` on. |
| AbuseIPDB, IPData, Stop Forum Spam | IP and signup reputation. | `thirdParty` on and a key configured. |
| OAuth providers | Connected accounts on Twitch, Epic Games, Battle.net, Reddit, Facebook, GitHub, Google, Spotify, Xbox, Discord and X. | `thirdParty` on, the connection configured and a user links an account. |
| Browser push services | Web Push, see [notifications.md](../features/notifications.md). | `thirdParty` and Web Push on. |
| SMTP, Mailgun, Mailjet, SendGrid | Email. | An operator configures one. |
| S3 | Object storage instead of local files. | An operator configures it. |
| A Cap Standalone server | Captcha, see [signup.md](../features/signup.md). | Standalone mode configured. |
| Hosts chosen by apps and users | OAuth callbacks, interaction endpoints, webhook avatars, embedded activities. | Always. |
| Other instances and the registry | Federation, see [federation.md](../features/federation.md). | Federation on. |
| Equicord plugins and themes | Whatever each optional plugin or theme contacts. | Users turn them on. |

Email, storage, app callbacks and client plugins ignore `thirdParty`. The client never contacts Discord's telemetry and Sentry endpoints.

GIF search is set in `integrations.gifs` on its own Site settings card, independent of `thirdParty`. Users pick Klipy or Tenor in the GIF picker. The settings API never returns stored keys.

## Hiding the server's address

Every URL that users, bots and other instances choose goes through the SOCKS5 proxy in `PUBLIC_FETCH_PROXY`, so the receiving site sees the proxy's address. That covers link previews, the `/external` media proxy, video preview frames, webhook avatars, interaction endpoints, Web Push, domain verification and federation.

| `PUBLIC_FETCH_PROXY` | Result |
| --- | --- |
| `socks5://host:port` | Requests to public addresses go through the proxy. |
| `direct` | Requests leave from the server's own address, for development only. |
| unset or invalid | Requests to public addresses fail. |

Compose runs Cloudflare WARP as the `warp` service, and [native.md](native.md#runtime-configuration) covers a native install. An unset, `direct` or invalid value logs a `[Network] Warning` line at startup, and the Link previews card on the System page of the admin dashboard shows the mode and whether the proxy answers within 2 seconds. Requests to the instance's own CDN and to private addresses allowed by `security.allowPrivateNetworkRequests` skip the proxy. [limits.md](../security/limits.md#fetching-urls-that-users-pick) covers the address checks and size caps.
