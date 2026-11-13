# Desktop and Android apps

Discord OSS has apps for macOS, Windows, Linux and Android. Both load the web client an instance already serves, the same Discord client with Equicord and the instance's branding, so the apps look and behave like the browser version, including voice, video and screen sharing. The desktop app is an [Electron](https://www.electronjs.org) shell in `apps/desktop`, like the official Discord desktop app. The Android app is a [Capacitor](https://capacitorjs.com) app in `apps/mobile`. Both are called Discord OSS and use the icon in `apps/icon/icon.svg`, a white Clyde on `#3BA3E8`. `apps/icon/icon.png` is the same icon at 1024 pixels.

## Instance switcher

Both apps start on the instance switcher when no instance is picked yet. It asks for an address, fetches [`/.well-known/discord-oss`](../development/instance-discovery.md), checks that `software.name` is `discord-oss`, and saves the instance with the name and icon from the response. An address without a scheme gets `https://`, or `http://` for `localhost`, `.local` names and private IP ranges. The switcher lists every saved instance with the most recent first, opens one with a click and removes one with the × button. After that the app opens the last instance straight away.

- Desktop: the switcher is under File > Switch Instance and in the tray menu, which also lists the saved instances to switch with one click, and `Ctrl+Shift+O` (`Cmd+Shift+O` on macOS) opens it. Pages from an instance can call `window.DiscordOSS.openInstanceSwitcher()`. If an instance doesn't load, the switcher opens with the error.
- Android: the Back button on the first page of an instance opens the switcher, and Back on the switcher returns to the instance. Back on the switcher at launch puts the app in the background. Long pressing the app icon shows a Switch instance shortcut. Pages can call `window.DiscordOSS.openInstanceSwitcher()`.

## Desktop app

- Voice and video: the instance's pages get microphone, camera, notification, clipboard and fullscreen permissions. Pages from anywhere else get none. On macOS the app asks for microphone and camera access the first time a page needs them.
- Screen sharing: Go Live opens a picker with Screens and Applications tabs, a thumbnail for each and a Share system audio box. System audio works on Windows, and on macOS 13 and later. On macOS 15 and later the app uses the system's own picker instead. On Linux under Wayland the PipeWire portal is used.
- Notifications use the system's notifications, and clicking one brings the window to the front. The unread mention count shows on the dock icon on macOS, on the launcher on Linux and as a red overlay on the taskbar on Windows. The window flashes when a new mention arrives in the background.
- Closing the window keeps the app running in the tray. The tray menu turns this off, and turns Start at Login on or off. Started at login, the app opens in the tray.
- Links to other sites open in the default browser. `discord-oss://` links open in the app: `discord-oss://invite/abc` opens `/invite/abc` on the current instance, and `discord-oss://open?instance=https://chat.example.org&path=/channels/@me` opens a path on a saved instance. A link to an instance that isn't saved opens the switcher with the address filled in, so the user confirms it first.
- Only one copy runs at a time. Window size, position and maximized state are restored on the next start.
- Spellcheck underlines misspelled words, and right clicking one offers up to 5 suggestions and Add to Dictionary. Right clicking a link, an image or selected text offers the usual copy, open and save items.
- The window keeps running JavaScript at full speed when hidden, so calls don't drop.
- Music: File > Open SoundCloud and the tray menu open soundcloud.com in a window with its own session, and the app reads what plays there and in the Spotify app, so your profile shows a Listening activity. [music-presence.md](music-presence.md) describes how each system is read.
- The renderer is sandboxed with context isolation. The preload script exposes `window.DiscordOSS` with `platform`, `focusWindow()`, `openInstanceSwitcher()` and `music` (`watch`, `onTracks` and `openSoundCloud`) to instance pages, and the switcher calls to the app's own pages. The main process checks which page sent each message.
- Settings, the saved instances and the window state are in `settings.json` in the app's user data folder: `~/Library/Application Support/Discord OSS` on macOS, `%APPDATA%\Discord OSS` on Windows and `~/.config/Discord OSS` on Linux.

Run it from source with `bun install --cwd apps/desktop` and `bun run --cwd apps/desktop start`. `bun run --cwd apps/desktop typecheck` checks the TypeScript. The pages in `apps/desktop/static` load their scripts from `apps/desktop/dist/pages`, which `bun run --cwd apps/desktop build` compiles from `apps/desktop/src/pages`.

## Android app

- Microphone and camera: the first call or video asks for the Android permissions, then the page gets them.
- Calls keep going in the background. While a microphone track is live, the app runs a foreground service with an "In a voice call" notification and a wake lock, so Android doesn't stop the call. It stops when the call ends.
- Notifications: Android's WebView has no Notification API, so the app adds one. When the app isn't focused, a message notification from the client becomes an Android notification that opens the app. The app asks for notification permission on Android 13 and later. Notifications only arrive while the app is running, because there are no push notifications yet.
- Downloads go to the Downloads folder through Android's download manager with the login cookies. Uploads use the system file picker.
- The splash screen shows the icon on `#3BA3E8`. The status and navigation bars use the dark background `#1A1A1E`, and the page keeps clear of the bars and the keyboard.
- The WebView runs with hardware acceleration, renders offscreen content ahead of scrolling, plays sounds without a tap and keeps its renderer at high priority. Links to other sites open in the browser.

Run `bun install --cwd apps/mobile` and `bun run --cwd apps/mobile sync` to compile the switcher and copy it into `apps/mobile/android`, then open `apps/mobile/android` in Android Studio or run `./gradlew assembleDebug` there. It needs JDK 21 and the Android SDK 36.

## Building the installers and APK

`.github/workflows/apps.yml` builds everything. On pull requests that touch `apps/` it only typechecks both apps. On a tag such as `apps-v1.0.0`, or when run by hand from the Actions tab, it builds:

| Platform | Files                                                     | Built on         |
| -------- | --------------------------------------------------------- | ---------------- |
| macOS    | One universal `.dmg` and `.zip` that runs natively on Apple silicon and Intel | `macos-latest`   |
| Windows  | `.exe` installer for x64 and Arm64                        | `windows-latest` |
| Linux    | `.AppImage` and `.tar.gz` for any distribution, `.deb` for Debian and Ubuntu, `.rpm` for Fedora, openSUSE and RHEL, and `.pacman` for Arch, each for x64 and Arm64 | `ubuntu-latest`  |
| Android  | `.apk`                                                    | `ubuntu-latest`  |

The files are uploaded as workflow artifacts, and a tag also attaches them to a GitHub release named after the tag. The version comes from the tag, and `1.0.0` otherwise. The Windows job checks out only `apps/` with `core.protectNTFS` off, because some paths in the repository contain `:`, which Windows can't check out.

Signing is optional:

- macOS: set `CSC_LINK` (a base64 `.p12`) and `CSC_KEY_PASSWORD`, and `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` to notarize. Without them the app is signed ad hoc, and macOS asks to confirm opening it the first time, with Open in System Settings > Privacy & Security.
- Windows: `CSC_LINK` and `CSC_KEY_PASSWORD` sign the installer too. Without them SmartScreen warns on first run.
- Android: set `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD` and optionally `ANDROID_KEY_ALIAS` (default `discord-oss`). Without them each build is signed with a new key, and Android won't install it over an earlier one.

To build the desktop installers locally, run `bun run --cwd apps/desktop dist`. They land in `apps/desktop/release`.

## Switching the official Discord desktop apps

The official Discord desktop apps (Stable, PTB, Canary and Development) can use a Discord OSS instance too, with an instance switcher inside the app. `apps/official-desktop` holds a small module that the app's own main process loads in front of Discord's desktop core, and an installer that adds it. Nothing in Discord's files changes except one `try { require(...) } catch` line at the top of `discord_desktop_core/index.js`, and a failure in the module can't stop Discord from starting.

Once installed, the app has a Switch instance item in its tray menu and, on macOS, in the app menu, and `Cmd+Shift+O` or `Ctrl+Shift+O` opens it from the main window. The switcher lists Discord and the instances used before, with the current one marked, and has a field to add one. A new address is checked through `/.well-known/discord-oss`. Choosing an instance writes `WEBAPP_ENDPOINT` and `API_ENDPOINT` to the app's `settings.json`, which the official app reads itself, and restarts the app. Choosing Discord removes both keys. The list is kept in `discord-oss-instances.json` next to `settings.json`.

The installer is one program per platform, built by the `switcher` job in `.github/workflows/apps.yml` as `Discord-OSS-Instance-Switcher-<platform>`:

| Command | What it does |
| --- | --- |
| `install` | Adds the switcher to every official app it finds, or only one with `--channel stable`, `ptb`, `canary` or `development`. |
| `install --instance discord.lifestyle` | Also points the app at that instance right away. `--discord` points it back at discord.com. |
| `uninstall` | Removes the line and the module again. |
| `status` | Lists the apps it found and whether the switcher is installed. |

It finds the apps in `~/Library/Application Support/<profile>` on macOS, `%LOCALAPPDATA%\<app>` on Windows and `~/.config/<profile>` on Linux. Restart the app after installing. A Discord update replaces the desktop core, so run `install` again after one. `scripts/tests/official-desktop-switcher.test.cjs` covers the settings it writes, the discovery check and installing into a fake app folder.
