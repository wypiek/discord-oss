# Documentation

## Running an instance

| Page | Covers |
| --- | --- |
| [setup.md](self-hosting/setup.md) | Start here. Docker Compose install, environment variables, the operator account, proxies, backups, updates, optional content and SQLite. |
| [native.md](self-hosting/native.md) | Running under systemd without Docker. |
| [external-services.md](self-hosting/external-services.md) | Every outside service the instance contacts, and the proxy that hides its address. |
| [verification.md](self-hosting/verification.md) | Getting an instance listed in `instances.json`. |
| [change-url.md](self-hosting/change-url.md) | Moving an instance to a new address. |
| [workers.md](self-hosting/workers.md) | Running the instance on Cloudflare Workers. |
| [limits.md](security/limits.md) | Upload, storage, fetch and image decoding limits. |

## Features

| Page | Covers |
| --- | --- |
| [admin.md](features/admin.md) | The admin dashboard at `/admin`. |
| [signup.md](features/signup.md) | Registration, Cap verification and email. |
| [invites.md](features/invites.md) | Invite-only registration, instance invites and invite trees. |
| [automod.md](features/automod.md) | Instance moderation, word lists, account approval, spam and raid protection, and server AutoMod. |
| [e2ee.md](features/e2ee.md) | End-to-end encrypted DMs, key backup and recovery. |
| [announcements.md](features/announcements.md) | Encrypted announcements from the official account. |
| [discovery.md](features/discovery.md) | The Discover page, search and ranking. |
| [notifications.md](features/notifications.md) | Notification settings, read states and Web Push. |
| [link-embeds.md](features/link-embeds.md) | Link previews and embedded media. |
| [activities.md](features/activities.md) | Embedded activities. |
| [profile-widgets.md](features/profile-widgets.md) | Application profile widgets. |
| [badges.md](features/badges.md) | Profile badges, levelled badges, legacy badges, the Features badge and rarity. |
| [pride-badges.md](features/pride-badges.md) | Pride flags after display names and at signup. |
| [homepage.md](features/homepage.md) | The instance homepage and the loading screen. |
| [blog-and-help.md](features/blog-and-help.md) | The public blog and help centre, the Markdown they accept and how the dashboard edits them. |
| [whats-new.md](features/whats-new.md) | What's New changelogs and how operators write them. |
| [typing-indicator.md](features/typing-indicator.md) | Custom typing indicators with emojis, animations and your own text. |
| [testing-status.md](features/testing-status.md) | The Testing status, a blue dot that mutes notifications, for accounts with the TESTING_PRESENCE right. |
| [invite-roles.md](features/invite-roles.md) | Invites that give roles to the people who join through them. |
| [status.md](features/status.md) | The public status page, component groups, uptime history and the API response time chart. |
| [phones.md](features/phones.md) | The client on phones, installing it to the home screen, and Discord's Android app. |
| [desktop.md](features/desktop.md) | The Discord OSS desktop and Android apps, their instance switcher, and building the installers and APK. |

## Development

Read [CONTRIBUTING.MD](../CONTRIBUTING.MD) first.

| Page | Covers |
| --- | --- |
| [client-patches.md](development/client-patches.md) | How the Discord client is patched, built and checked. |
| [parity.md](development/parity.md) | Every Discord feature and its state here. |
| [work-backlog.md](development/work-backlog.md) | The task queue. |
| [security.md](development/security.md) | The October 2026 security review and how to rerun its checks. |
| [runtime-internals.md](development/runtime-internals.md) | Event transport, shutdown and JSON worker limits. |
| [android-client.md](development/android-client.md) | Discord's Android app and the mobile bundle that points it at an instance. |
| [native-ui.md](development/native-ui.md) | Shared native UI adapters for plugins. |
| [dialog-dismissal.md](development/dialog-dismissal.md) | How owned dialogs and the developer portal dismiss. |
| [admin-api-coverage.md](development/admin-api-coverage.md) | Which API operations the admin dashboard covers. |
| [instance-discovery.md](development/instance-discovery.md) | `/.well-known/discord-oss`, which tells clients an instance's name, icon, endpoints and signup rules. |
| [e2ee-protocol.md](development/e2ee-protocol.md) | The encryption protocol byte by byte, for writing another client. |
