# Game activity and game profiles

When you play a game with the [desktop app](desktop.md) open, your profile, the member list and your user area show "Playing" with the game's name, icon and elapsed time, like the official Discord desktop app. Clicking the game in someone's activity opens its game profile. A browser can't see the computer's processes, so in a browser nothing is detected, but everyone still sees the games of people who use the desktop app.

## Detection in the desktop app

The desktop app matches the processes you run against Discord's detectable games list, the same list the official app uses, which the instance serves (25,279 games in November 2026).

- The app fetches the list from `GET /api/v9/games/detectable/executables?os=<darwin|win32|linux>`. It needs no login and returns each game's id, name, aliases and the executables for that system, about 520 KB gzipped for macOS and 660 KB for Windows and Linux. Linux gets the Windows executables too, for games that run under Wine or Proton. The app keeps the list in `games/` in its user data folder and asks again after 12 hours with `If-None-Match`, so an unchanged list costs one 304 response.
- It only scans while the web client asks it to, through `window.DiscordOSS.games.watch()`, and scans every 15 seconds. It sends the page an update only when the set of running games changes.
- macOS: `ps -x -o pid=,comm=` lists your own processes, about 60 ms for 350 processes. The full command line is read with a second `ps` call only for processes whose name needs one, such as `java` for Minecraft.
- Windows: one hidden PowerShell process reads `Win32_Process` every 15 seconds and reports executable paths, whether the process has a window, and the command line only for the 5 executable names that need one. It exits when the app does, and restarts 30 seconds after a crash.
- Linux: the app reads `/proc/<pid>/exe` and `/proc/<pid>/cmdline` of your own processes. For Wine and Proton games it uses the Windows path in the command line.

### Matching

A process matches a game when one of the game's executable names equals the end of the process path, compared segment by segment and ignoring case, so `win64/cs2.exe` matches `C:\...\game\bin\win64\cs2.exe` but `cs2.exe` in another folder does not. A name starting with `>` must equal the file name exactly. When the list gives `arguments`, the command line must contain them. On macOS a name ending in `.app` matches the main executable of that bundle, `Name.app/Contents/MacOS/<file>`, and not the helper apps inside it.

The list has executables for 10,466 Windows games but only 67 macOS and 8 Linux games. So on macOS and Linux a game installed by Steam also matches when its `steamapps/common/<folder>` name equals the game's name or one of its aliases, ignoring case, spaces and punctuation. Launcher executables are skipped, and each game is reported once.

The web client gets each running game as the official app's native module reports it, with the process id, name, path and application id.

## In the web client

The FosscordGames plugin feeds the desktop app's detections into the client's own RunningGameStore, the store the official desktop app fills. It patches the store so the parts that call the native module call the plugin instead: the list of observed games, the game candidate overrides and the detection callbacks. Everything after that is the client's own code:

- The LocalActivityStore turns the visible running game into a Playing activity with the application id and a start time, and the client sends it in the presence update. The user area, the member list and profiles show it.
- Settings > Games & Apps > Registered Games shows in the desktop app. It lists the current game as Now playing! and every game seen before with Last played. Each has a Toggle detection switch, and the menu removes a game. Not seeing your game? Add it! lists the running apps the desktop app offers as candidates: on macOS app bundles outside `/System`, on Windows processes with a window outside `C:\Windows`, on Linux processes under your home folder, `/opt` or `/usr/games` and Wine programs. An added game is sent back to the desktop app, which reports it by its path from then on, under the name you gave it.
- Settings > Activity Privacy > Share your detected activities with others decides whether the game is sent. With it off, the presence update has no Playing activity and others stop seeing it. Detection keeps running for Registered Games, as in the official app.

The plugin also makes the client's native module wrapper return an empty module while the desktop app's bridge is present, so code that asks for the window's fullscreen state or an overlay lock gets no answer instead of throwing. The plugin's Detect the games you play with the desktop app setting stops scanning entirely. In a browser, and in the official Discord desktop app, the plugin does nothing.

## For other people

The server stores and forwards the activity as the client sends it: type 0, `name`, `application_id` and `timestamps.start`, with `content_classification: { "loaded": true }` added so other clients don't hide it, see [music-presence.md](music-presence.md#activities-for-other-users).

To draw the icon, other clients ask for the application. `GET /applications/public?application_ids=`, `GET /applications/:id/public` and `GET /oauth2/applications/:id/rpc` answer for a game that has no application on the instance with the game's entry from the detectable list: name, `icon` from `icon_hash`, `cover_image`, aliases, executables and `type: 5`, the game application type. The icon loads from the CDN's `/app-icons/<id>/<hash>.png`, which fetches it from Discord's CDN once when `externalRequests.discordAssetFallback` is on.

## Game profiles

Clicking the game's name in an activity card opens its game profile, and so does View Game Profile in the activity card's menu. The client shows the option when `/applications/public` returns the application with `type: 5` and `GET /games?game_ids=` returns the game without the disabled flag. No experiment gates it. The profile shows:

| Part | Data |
| --- | --- |
| Header, icon and cover | The game's name, and its icon and cover image from the detectable list as `/app-icons/<id>/<hash>.png` URLs on the instance's CDN. |
| Similar Games | Up to 6 games from `GET /content-inventory/users/@me/similar-games/:id`, the games that share at least 2 of the game's themes, such as Sandbox and Survival, ranked by how many of their themes they share. |
| Details | Platforms from the executables in the list: Desktop for Windows, macOS and Linux. Genres, publishers, developers and the release date show a dash, because the list doesn't have them. |
| Add to Profile | Adds the game to a profile widget, see [profile-widgets.md](profile-widgets.md). |

`GET /games/:id/announcements` returns no messages and `GET /partner-sdk/storefront-config` returns no storefronts, so those sections stay hidden. The game record has no `third_party_skus`, store websites, shop collections or linked applications, so the profile has no Get Now, Steam, Xbox Game Pass, Try Game, Game Shop or Discord Items buttons. The plugin removes the "Are you the developer for this game? Claim it" line, which links to Discord's developer portal.

## Checking it

`scripts/tests/game-detection.test.cjs` checks the matcher with process lists from each system: app bundles and helpers, `java` with Minecraft's arguments, path suffixes on Windows, Wine command lines, Steam folders, user-added games and candidates.

`PORT=<port> bun scripts/dev/game-activity-probe.mjs` opens two accounts from `scripts/dev/.test-account` in headless Chromium. The first page gets a simulated `window.DiscordOSS.games` that reports Minecraft as running. The probe checks the presence update, the second account's member list, profile popout and icon, the game profile, the Activity Privacy switch and adding a game under Registered Games. `SHOTS=<folder>` saves screenshots and `GAME_PROFILE=0` skips the game profile. It takes about 50 seconds, so run it through `scripts/dev/outside-app.sh` from the Claude desktop app.
