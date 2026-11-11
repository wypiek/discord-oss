# Notifications

The Discord client decides whether a message shows a desktop notification, plays a sound or adds a badge. The server sends the data it decides from, syncs notification settings and read states between sessions, and reaches users with no tab open through Web Push.

## Desktop notifications

On the web the client starts with desktop notifications set to "never". When a user turns on Enable Desktop Notifications in Settings, Notifications, the `FosscordNotifications` plugin asks the browser for permission in the same click.

## Settings and badges

The server counts mentions for the red badges the client shows at startup. A message counts as a mention for a user when it is in a DM or group DM they're in, mentions them, mentions a role they have, or is `@everyone` or `@here`, unless they suppressed role or everyone mentions. `@here` only counts while they have a connected session. The author never counts, and neither do users who blocked or ignored the author or can't view the channel. In threads, `@everyone` and `@here` only reach thread members.

Reading a channel or marking it unread carries over to the user's other sessions.

## Inbox

The Mentions tab lists mentions the user can still see, and dismissing one removes it in every session. The For You tab isn't implemented.

## Threads and message requests

A joined thread follows its own notification level, or its parent channel's when it has none. Threads the user hasn't joined never notify. A DM from someone who isn't a friend goes to Message Requests and never notifies, by desktop notification or by Web Push.

## Web Push

Once the user is logged in and has granted notification permission, a client script registers a service worker at `/notifications-sw.js`, subscribes with the instance's VAPID key and sends the subscription to the server. Logging out, or removing the session from Devices, deletes the subscription. Chrome for Android has no `new Notification()`, so there the client's own notifications also go through this worker.

The server sends each push to the browser vendor's push service, so Web Push needs `externalRequests.thirdParty` on and a working `PUBLIC_FETCH_PROXY`, as [external-services.md](../self-hosting/external-services.md) describes. Push endpoints must be public `https` URLs unless `security.allowPrivateNetworkRequests` is on.

For each new message the server skips users who:

- have a connected gateway session, since their open tab already notifies,
- are set to Do Not Disturb,
- would see a message request, a message from a blocked or ignored author, or a channel they can't view,
- turned off Mobile Push Notifications for that server, which here controls Web Push.

The server also skips `@silent` and ephemeral messages, and otherwise follows the client's rules for mutes, overrides and notification levels.

A push carries the sender's name and avatar, the channel and server name and the message text. Clicking it opens the message in an open tab or a new one. A [UnifiedPush](https://unifiedpush.org) distributor such as ntfy works too.

| Key | Default | Meaning |
| --- | --- | --- |
| `security.webPush.enabled` | `true` | `false` turns Web Push off and keeps stored subscriptions. |
| `security.webPush.vapidPublicKey` | generated | P-256 public key in base64url, generated on first start. Changing it makes every browser subscribe again. |
| `security.webPush.vapidPrivateKey` | generated | The matching private key. |
| `security.webPush.subject` | `null` | VAPID contact, a `mailto:` or `https:` URL. When it is empty the server uses `mailto:push@<api host>`. Set a real address on a public instance. |

Browsers only allow push on `https` origins and on `localhost`. Chrome, Edge and Firefox work out of the box. Brave needs "Use Google services for push messaging" turned on in its privacy settings, or subscribing fails with "push service error". Safari works on macOS from version 16, and on iOS only after the site is [added to the home screen](phones.md#installing-to-the-home-screen).
