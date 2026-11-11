# Desktop app

`desktop/` is a native desktop client written in Rust with a [Slint](https://slint.dev) interface. It doesn't embed a browser. It talks to an instance's REST API and gateway directly and draws its own interface, in Slint's Cupertino style on macOS and Fluent style on Windows and Linux, following the system's light or dark mode. Its product name is OSS Chat, set in `desktop/Cargo.toml` and `APP_NAME` in `desktop/src/app.rs`.

## What it does

- Adds instances by address. It reads [`/.well-known/discord-oss`](../development/instance-discovery.md), shows the instance's name, description and whether signups are open, and keeps a list of instances in `instances.json` in the system's config folder.
- Logs in with an email or username and password, with an authenticator or backup code when the account has two-factor authentication. The token goes into the system keychain: Keychain on macOS, Credential Manager on Windows and the Secret Service on Linux. "Create an account" opens the instance's `/register` page in the browser, because signup needs a Cap captcha that only runs in a browser.
- Shows servers, their channels in Discord's order with categories, and only the channels the account can see, from the roles and permission overwrites in the READY payload.
- Reads and sends messages in text and announcement channels, loads older messages 50 at a time, and shows new, edited and deleted messages live from the gateway. Messages from the same author within 7 minutes are grouped. Mentions, channel links, role mentions, custom emoji and `<t:...>` timestamps are shown as text. Attachments open in the browser.
- Reconnects to the gateway with a backoff of 1 to 30 seconds, and goes back to the login screen when the token stops working.

## What it doesn't do yet

- Encrypted DMs. DMs and group DMs are listed, but their messages show as encrypted and the composer is off, with an "Open in browser" button. Reading them needs the protocol in [e2ee-protocol.md](../development/e2ee-protocol.md) ported to Rust.
- Voice and video, threads, forums, reactions, replies, editing and deleting, uploads, member lists, notifications, unread markers, markdown and embeds.
- Logging in when the instance turns on `login.requireCaptcha`. The app says so and points to the website.

## Build and run

Install Rust 1.88 or later. On Linux, install `libfontconfig1-dev libxkbcommon-dev libxcb-shape0-dev libxcb-xfixes0-dev libssl-dev pkg-config` first.

```sh
cd desktop
cargo run
cargo test
OSS_CHAT_TEST_INSTANCE=localhost:3001 OSS_CHAT_TEST_TOKEN=<token> cargo test live -- --ignored --nocapture
```

The last command checks discovery, a failed login, the gateway READY, the channel list and loading messages against a running instance, without opening a window.

## Installers

[cargo-packager](https://github.com/crabnebula-dev/cargo-packager) builds them from the `[package.metadata.packager]` section of `desktop/Cargo.toml`. Each platform builds its own:

| Platform | Command in `desktop/` | Output in `target/packages` |
| --- | --- | --- |
| macOS | `cargo packager --release --formats app,dmg` | `.app` and `.dmg` |
| Windows | `cargo packager --release --formats nsis,wix` | `.exe` and `.msi` |
| Linux | `cargo packager --release --formats deb,appimage` | `.deb` and `.AppImage` |

Run `cargo build --release` first and install the tool with `cargo install cargo-packager --locked`.

`.github/workflows/desktop.yml` runs `cargo fmt --check`, Clippy and the tests on pull requests that touch `desktop/`. Run it by hand, or push a tag such as `desktop-v0.1.0`, and it also builds the macOS installers for Apple silicon and Intel, the Windows installers and the Linux packages, uploads them as workflow artifacts and, for a tag, attaches them to a draft GitHub release.

The installers aren't signed. macOS refuses to open the app until the user right-clicks it and picks Open, or runs `xattr -dr com.apple.quarantine "/Applications/OSS Chat.app"`. Windows SmartScreen asks for "More info" and "Run anyway". Signing needs an Apple Developer ID with notarization, set under `[package.metadata.packager.macos]`, and a Windows code-signing certificate.
