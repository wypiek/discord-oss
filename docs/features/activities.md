# Activities

Activities are embedded apps that run in an iframe inside a voice channel or a DM call. The client has Discord's shelf and Embedded App SDK bridge, and the server provides the data and hosts the apps.

## Hosting

The client loads an activity from `<application id>.<activity host>`. The activity host is `client.activityApplicationHost`, or the instance's own host when that is empty, so on `chat.example.com` an activity loads from `https://1234567890123456789.chat.example.com`. That needs a wildcard DNS record and a wildcard certificate. Set `client.activityApplicationHost` to a host such as `activities.example.com` to keep activities on their own domain. A development instance on `localhost:3001` needs no setup, because `<id>.localhost` resolves to 127.0.0.1.

The server answers a request on an activity host from that application's URL mappings, with or without Discord's `/.proxy` prefix. The longest matching prefix wins.

- A `builtin://<name>` target serves an activity bundled with the server.
- Any other target, an `https://` URL or a bare domain with an optional path, is reverse proxied. The proxy doesn't forward cookies. It needs `externalRequests.thirdParty`, refuses targets that resolve to a private address unless `security.allowPrivateNetworkRequests` is on, and gives up after 15 seconds. Request bodies are capped at 8 MiB and responses at 32 MiB.

## Your own activities

Developers turn activities on for an app in the developer portal at `/developers`, under Activities. The same page edits the URL mappings, the supported platforms and the age gate. Turning activities off keeps the settings, and the activity host and launches stop answering.

A new activity is unreleased, and only the owner and up to 50 app testers, who must be the owner's friends, can start it. Anyone in the channel can join a running instance. Releasing the activity lets anyone start it from its `launch` command. An operator lists an activity in everyone's shelf by setting `on_shelf` on its `embedded_activities` row.

## Launching and joining

Starting an activity needs a voice state in the channel, and in a server the Use Activities permission. Each application has one instance per channel, and a user is in at most one instance. The instance ends when the last participant leaves the voice channel. A bot can also start its activity by answering an interaction with callback type 12, `LAUNCH_ACTIVITY`.

The iframe gets a signed proxy ticket that is valid for 12 hours. An activity backend checks who is in an instance with `GET /applications/:id/activity-instances/:instance_id` and its bot token.

## Whiteboard

The server ships one activity, a shared whiteboard, owned by the `official` system account. Boards live in memory and are gone once their instance ends.

## Not done yet

- The RPC `AUTHORIZE` and `AUTHENTICATE` commands. Activities only get the handshake and the commands that need no OAuth2 scope.
- Proxying WebSocket upgrades to external targets.
