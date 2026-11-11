# Federation

Approved Meowcord instances list each other's public servers in Discovery. People on one instance can join servers on another, add friends there, send them DMs and talk in their voice channels. Each account stays on its own instance, its home, and the client only ever talks to the home. The [federation plan](../development/federation.md) explains the design, and [federation-protocol.md](../development/federation-protocol.md) has the wire format and every endpoint.

## Turning it on

Federation is on by default. On first start the server creates an Ed25519 key in `federation.key` in its working directory. Back it up with `jwt.key`, as [setup.md](../self-hosting/setup.md#data-and-backups) describes, and see [verification.md](../self-hosting/verification.md#staying-approved) for what a new key costs.

The instance id is the host of `general.serverName`, or of `api.endpointPublic` when the server name is empty, in lowercase, with the port when it isn't 443. [change-url.md](../self-hosting/change-url.md) explains how to change it.

Other instances only list this one after the registry approves it, as [verification.md](../self-hosting/verification.md) explains. Instances on localhost, an IP address or a private host name never announce themselves. Calls in servers on other instances also need the [TURN relay](#turn-relay).

## Config keys

| Key | Default | Meaning |
| --- | --- | --- |
| `federation.enabled` | `true` | Fetch the registry, publish the discovery list and show Other instances. |
| `federation.registry.url` | `https://meowcord-registry.tiag.workers.dev` | Registry address. The instance fetches it every 5 minutes. |
| `federation.registry.publicKey` | The registry's key | Ed25519 key in base64url. Changing it or the address forgets the stored list. |
| `federation.announce` | `true` | Announce to the registry on start and every 24 hours. |
| `federation.announceStats` | `true` | Send user, server and 24-hour message counts with the announce. |
| `federation.contacts` | `[]` | Up to 10 local usernames sent as contacts. Empty means the operators. |
| `federation.allowUnlistedPeers` | `false` | Federate with `federation.peers` even when the registry doesn't list them. The first key a peer serves is kept. |
| `federation.peers` | `[]` | Instance ids such as `meow.example`. |
| `federation.previousIds` | `[]` | Up to 10 ids this instance had before its address changed. |
| `federation.discovery.verification` | `registry` | `instance` makes this instance's admins pick which listed servers from other instances to show. |
| `federation.media.cacheSize` | `67108864` | Bytes of remote media cached in memory, at most 4 GiB. Files over a quarter of it aren't cached. |
| `federation.media.maxFileSize` | `52428800` | Largest remote file the media proxy fetches, at most 64 MiB. |
| `federation.media.cacheSeconds` | `3600` | Cache lifetime and the `max-age` sent to clients. |
| `federation.media.requestsPerMinute` | `600` | Uncached fetches from, and uploads to, one instance per minute. |
| `federation.limits.objectsPerInstance` | `200000` | Id mappings one other instance may have here. |
| `federation.limits.shadowsPerInstance` | `50000` | Users from one other instance stored here. |
| `federation.limits.guildsPerInstance` | `500` | Mirror servers from one other instance. |
| `federation.limits.inboxEventsPerInstance` | `200000` | Event ids remembered per sender to skip retries. |
| `federation.limits.newObjectsPerRequest` | `10000` | New ids one request may introduce. |

A request past one of the `federation.limits` quotas gets `507`. The admin Federation page edits every key except `federation.media.*` and `federation.limits.*`.

## Listing a server on other instances

The server owner turns on Show on other instances in Server Settings, Other instances. That gives the server a permanent invite if it has none, and people from other instances can join through it right away. Once this instance's admins verify the server on the admin Federation page, it goes into the instance's signed discovery list, and other instances show it as [verification.md](../self-hosting/verification.md#verifying-a-server-for-discovery) describes. The section shows the invite link and the listing state. Turning the switch off removes the server from other instances within about 5 and a half minutes. The registry can remove or block a server, and any instance can block it locally.

## Discover on other instances

Discover has an Other instances tab in Servers. It lists servers from approved instances, with a verified mark on those the registry lists, and the approved instances with their signup state. A search in Discover also shows matching servers from other instances above the local results. The browser never contacts another instance, because this instance answers from lists it fetches from them every 5 minutes. The tab and its server previews share a rate limit of 60 requests per 30 seconds per account.

## Chat across instances

When a user acts in a server or conversation hosted on another instance, their home relays the request to the host. The host runs it as a copy of the account, a shadow user, with the same permission checks, automod and rate limits as for its own users.

- Joining a server on another instance copies the channels the user can see, roles, emojis, stickers and members to the home as a mirror server. Messages, reactions, mentions, typing and the member list work as in a local server.
- Join a Server takes `https://<instance>/invite/<code>` or `<instance>/invite/<code>`.
- People from other instances appear as `name@instance`. Add Friend takes that form or a friend link, `https://<instance>/add/<name>`.
- A DM or group DM lives on the instance of the person who started it, and it is always end-to-end encrypted, as [e2ee.md](e2ee.md#conversations-with-users-of-other-instances) describes.
- Badges from a person's home show in a separate "On <instance>" box, at most 12. A staff badge from another instance shows only as a "Staff on <instance>" label, and remote badges never grant rights.
- Reporting a message or server from another instance sends the report to that instance's staff.

When the host is down, loading or sending there fails with `502`, or `504` on a timeout, and the message names the host. Events the host couldn't deliver go out within seconds once the home is reachable again.

## Voice across instances

Voice channels in servers on other instances work like local ones, with voice, camera and Go Live in both directions. DM and group DM calls with people on other instances run on the instance that hosts the conversation. DAVE end-to-end encryption stays on.

The host never learns a user's IP address. The client connects to its home at `/federated-voice`, which forwards the connection to the host, and sends media only through the TURN relay in the home's SFU. When the home has no relay, it refuses the call instead of connecting directly. Calls between people on the same instance don't use the relay.

### TURN relay

The relay runs inside `pion-sfu` when the SFU has `TURN_SECRET`, and the server signs relay credentials with the same secret. A server that starts the SFU itself through `PION_SFU_BIN` generates a random secret on every start when `TURN_SECRET` is empty. Docker runs the SFU as its own service, so set `TURN_SECRET` in `.env` there, or calls in servers on other instances are refused.

| Variable | Read by | Default | Meaning |
| --- | --- | --- | --- |
| `TURN_SECRET` | SFU and server | Random per start, native only | Shared secret, from `openssl rand -hex 32`. Empty in Docker turns the relay off. |
| `TURN_PORT` | SFU and server | `3478` | UDP and TCP port of the relay. `0` turns it off. |
| `TURN_PUBLIC_IP` | SFU and server | `WRTC_PUBLIC_IP` | Address clients reach the relay on, the outside address behind NAT. |
| `TURN_LISTEN_IP` | SFU | `0.0.0.0` | IPv4 address the relay binds to. |
| `TURN_RELAY_PORT_MIN` | SFU | `49160` | First UDP port of the relayed range. Each call uses one port. |
| `TURN_RELAY_PORT_MAX` | SFU | `49200` | Last UDP port of the relayed range. |
| `TURN_REALM` | SFU | `meowcord` | TURN realm. |
| `TURN_CREDENTIAL_TTL` | server | `43200` | Seconds a credential stays valid. A value under 60 falls back to the default. |
| `TURN_ALLOW_PRIVATE_PEERS` | SFU and server | off | `1` lets the relay reach private addresses. Only for testing on one machine. |

Open `TURN_PORT` over UDP and TCP and the relayed range over UDP. A credential only reaches the public IPv4 address of the host SFU named in it, so nobody can use the relay as an open relay or to reach the home's network. For every relayed call the SFU logs `TURN allocation for <client> over <protocol> relays from <address>`.

## Admin Federation page

The Federation page of the admin dashboard, under Instance, is for operators. It shows the registry state, edits the federation settings and peers, and sends the announce. It lists the servers that turned on Show on other instances, with a button to verify each one. When `federation.discovery.verification` is `instance`, it also lists the servers other instances offer.

It also manages local blocks of instances, servers and users by canonical ids such as `@123@meow.example`. Blocking an instance hides its servers and users and stops all traffic with it right away. It shows event delivery to each instance. Undelivered events wait in the `federation_outbox` table, at most 10,000 per instance, and events still waiting after 24 hours are dropped. It shows storage per instance against `federation.limits` and instance moves. [admin.md](admin.md#users-and-servers-from-other-instances) lists what an admin can do to users and servers from other instances.

Shadow users and mirror servers don't count as this instance's own in the admin overview, `GET /api/v9/policies/stats`, announcements or the registration limit. Accounts from other instances go through this instance's automod, as [automod.md](automod.md#federation) describes.

## Media from other instances

Browsers never load anything from another instance. The home fetches remote files, serves them at `/federation-media/<instance id>/<path>` and rewrites media URLs from other instances to that route. It only fetches known CDN paths from instances it federates with, follows no redirects, waits at most 20 seconds and fetches at most `federation.media.maxFileSize`. Files that aren't images, video or audio are served as plain text or a download, with `nosniff` and a sandboxing CSP.

An upload into a channel on another instance goes to a signed `/federation-upload/...` URL on the home, valid for 24 hours, which forwards the file to the host. The limit is `cdn.maxAttachmentSize`, and at most 64 MiB.

## Shop items from other instances

Avatar decorations of people from other instances show in messages, the member list, DMs, profiles and voice. Their nameplates show in the member list and the DM list, and their profile effects show on their profiles. When the shop item exists here with the same art, as Discord's shop items do, this instance uses its own copy. Otherwise it fetches the art from the other instance through the media proxy, at most 10 MiB, and asks that instance for a profile effect's animation settings. Profile frames from other instances show only when the frame is in this instance's shop too. People can equip an avatar decoration from their home's shop as their server decoration in a server on another instance, and that instance fetches its art from the home the same way. [Shop items](../development/federation-protocol.md#shop-items) in the protocol has the details.

## Threat model

Two attackers are in scope. One is an approved instance that turns malicious or whose domain someone takes over, so it holds a valid key. The other has no key and sends crafted requests to `/federation/v2`, the media proxy or the upload forward. `scripts/dev/federation-attack-probe.mjs` runs a rogue instance against a real one and prints `pass` for each attack the real instance blocks. [Testing on public addresses](../development/federation.md#testing-on-public-addresses) lists its options.

| Attack | Defense |
| --- | --- |
| Replay or forge a signed request | Signatures cover method, path, timestamp, nonce and a body hash. Nonces are kept for 10 minutes and timestamps more than 5 minutes off are refused. |
| Exhaust memory, disk or rows | Unverified bodies share a 128 MiB budget, and `federation.limits` caps what each instance stores. |
| Reach local-only or admin routes through the relay | The host relays only server and channel routes, invites, leaving, profiles and reports, and refuses any path a URL parser would change. |
| Act as a local user or another instance's user | Relayed actions, presence and voice states only apply to users of the sending instance. |
| Join local users to a server or DM | A home adds a local user to a remote server only after that user asked to join. A DM from another instance only takes local users who are friends with the sender, have a pending request or share a server, and never someone who blocked them. |
| Look like this instance's staff | Remote users keep only the HypeSquad and AI account flags, and remote staff badges show only as "Staff on <instance>". |
| Make this instance fetch arbitrary URLs or track viewers | Shop art and badge icons must be specific paths on the sender's own address, and browsers load them through the media proxy or this instance's CDN. |
| Make the TURN relay reach private networks | Credentials are issued only for public IPv4 addresses, and the relay checks again. |
| Turn encryption off in a DM | A home never clears encryption on a mirrored DM and refuses to relay a plaintext message into it. |
| Forge a message by another instance's user | The author's home signs every message and edit. Receivers drop new messages that fail the check and show stored ones as "Unverified author". See [message authorship](../development/federation-protocol.md#message-authorship). |

The host still decides what happens in the servers and conversations it hosts, including deleting messages and removing members. A host can serve an earlier signed version of an edited message and choose link previews and attachment bytes, since receivers check attachment names and sizes but not bytes. Nobody else signs system, automod, bot, webhook and interaction messages. A malicious instance can fill its own quota on every instance it federates with, which is why the quotas are per instance and shown on the admin page.
