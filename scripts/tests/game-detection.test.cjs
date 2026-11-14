const { test } = require("node:test");
const assert = require("node:assert/strict");

const match = require("../../apps/desktop/src/game-match.ts");
const { windowsScript } = require("../../apps/desktop/src/game-processes.ts");

const LIST = [
    {
        id: "358422126602223616",
        name: "Factorio",
        executables: [
            { is_launcher: false, name: "factorio", os: "linux" },
            { is_launcher: false, name: "factorio.app", os: "darwin" },
            { is_launcher: false, name: "factorio.exe", os: "win32" },
        ],
    },
    { id: "1158877933042143272", name: "Counter-Strike 2", executables: [{ is_launcher: false, name: "win64/cs2.exe", os: "win32" }] },
    {
        id: "1402418491272986635",
        name: "Minecraft",
        executables: [
            { arguments: "net.minecraft.client.main.Main", is_launcher: false, name: ">java", os: "darwin" },
            { arguments: "net.minecraft.client.main.Main", is_launcher: false, name: ">javaw.exe", os: "win32" },
            { is_launcher: false, name: "minecraft.windows.exe", os: "win32" },
        ],
    },
    {
        id: "1402418696126992445",
        name: "League of Legends",
        executables: [
            { is_launcher: false, name: "league of legends.app", os: "darwin" },
            { is_launcher: true, name: "leagueclientux.exe", os: "win32" },
            { is_launcher: false, name: "league of legends.exe", os: "win32" },
        ],
    },
    { id: "367827983903490050", name: "osu!", executables: [{ is_launcher: false, name: "osu!.exe", os: "win32" }] },
    { id: "bad", name: "No id", executables: [{ name: "bad.exe", os: "win32" }] },
];

test("the index keeps the executables for the platform and skips launchers", () => {
    const mac = match.buildGameIndex(LIST, "darwin");
    assert.deepEqual([...mac.executables.keys()].sort(), ["factorio.app", "java", "league of legends.app"]);
    assert.deepEqual([...mac.argumentNames], ["java"]);
    const windows = match.buildGameIndex(LIST, "win32");
    assert.ok(!windows.executables.has("leagueclientux.exe"));
    assert.ok(windows.executables.has("win64/cs2.exe"));
    assert.ok(!windows.executables.has("bad.exe"));
    const linux = match.buildGameIndex(LIST, "linux");
    assert.ok(linux.executables.has("factorio") && linux.executables.has("factorio.exe"));
    assert.deepEqual(match.buildGameIndex("nope", "linux").games, []);
});

test("macOS matches the main executable of an app bundle and java with its arguments", () => {
    const index = match.buildGameIndex(LIST, "darwin");
    const processes = match.parsePsList(
        [
            "  101 /Applications/Factorio.app/Contents/MacOS/factorio",
            "  102 /Applications/Factorio.app/Contents/Frameworks/Helper.app/Contents/MacOS/Helper",
            "  103 /Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home/bin/java",
            "  104 /usr/bin/java",
            "  105 /Applications/Safari.app/Contents/MacOS/Safari",
            "  106 /Applications/League of Legends.app/Contents/MacOS/LeagueofLegends",
            "",
        ].join("\n"),
    );
    assert.equal(processes.length, 6);
    assert.equal(processes[5].path, "/Applications/League of Legends.app/Contents/MacOS/LeagueofLegends");
    const args = match.parsePsArguments("  103 /Library/Java/bin/java -Xmx2G -cp x net.minecraft.client.main.Main --username Steve\n  104 /usr/bin/java -jar server.jar\n");
    for (const process of processes) process.cmdLine = args.get(process.pid);
    assert.ok(match.needsCommandLine(processes[2].path, index));
    assert.ok(!match.needsCommandLine(processes[0].path, index));
    assert.deepEqual(match.matchGames(processes, index, "darwin"), [
        { pid: 101, id: "358422126602223616", name: "Factorio", exePath: "/Applications/Factorio.app/Contents/MacOS/factorio", exeName: "factorio", cmdLine: "" },
        {
            pid: 103,
            id: "1402418491272986635",
            name: "Minecraft",
            exePath: "/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home/bin/java",
            exeName: "java",
            cmdLine: "",
        },
        {
            pid: 106,
            id: "1402418696126992445",
            name: "League of Legends",
            exePath: "/Applications/League of Legends.app/Contents/MacOS/LeagueofLegends",
            exeName: "LeagueofLegends",
            cmdLine: "",
        },
    ]);
});

test("Windows matches path suffixes, exact names and lowercases the reported path", () => {
    const index = match.buildGameIndex(LIST, "win32");
    const processes = match.parseWindowsProcesses(
        JSON.stringify([
            { i: 40, p: "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Counter-Strike Global Offensive\\game\\bin\\win64\\cs2.exe", w: 1 },
            { i: 41, p: "C:\\Games\\other\\cs2.exe", w: 1 },
            { i: 42, p: "C:\\Program Files\\Java\\bin\\javaw.exe", w: 1, c: "javaw.exe -cp x net.minecraft.client.main.Main" },
            { i: 43, p: "C:\\Riot Games\\League of Legends\\LeagueClientUx.exe", w: 1 },
            { i: 44, p: "C:\\Windows\\System32\\notepad.exe", w: 1 },
            { i: 45, p: "C:\\Users\\me\\AppData\\Local\\osu!\\osu!.exe", w: 0 },
            { i: 46, p: "C:\\Tools\\editor.exe", w: 1 },
            { i: "x", p: "C:\\bad.exe" },
        ]),
    );
    assert.equal(processes.length, 7);
    const games = match.matchGames(processes, index, "win32");
    assert.deepEqual(
        games.map((game) => [game.pid, game.name, game.exePath, game.exeName]),
        [
            [40, "Counter-Strike 2", "c:/program files (x86)/steam/steamapps/common/counter-strike global offensive/game/bin/win64/cs2.exe", "cs2.exe"],
            [42, "Minecraft", "c:/program files/java/bin/javaw.exe", "javaw.exe"],
            [45, "osu!", "c:/users/me/appdata/local/osu!/osu!.exe", "osu!.exe"],
        ],
    );
    assert.deepEqual(
        match.listCandidates(processes, games, "win32").map((game) => game.name),
        ["cs2", "editor", "LeagueClientUx"],
    );
    assert.equal(match.parseWindowsProcesses("not json"), null);
});

test("Linux reads Wine games from the command line and native games from the executable link", () => {
    const index = match.buildGameIndex(LIST, "linux");
    const wine = match.linuxProcess(300, "/usr/bin/wine64-preloader", "Z:\\home\\me\\Games\\Factorio\\bin\\x64\\factorio.exe\0--fullscreen\0");
    const native = match.linuxProcess(301, "/home/me/.local/share/factorio/bin/x64/factorio", "/home/me/.local/share/factorio/bin/x64/factorio\0");
    const deleted = match.linuxProcess(302, "/home/me/game/run (deleted)", "./run\0");
    assert.equal(wine.path, "Z:\\home\\me\\Games\\Factorio\\bin\\x64\\factorio.exe");
    assert.equal(wine.cmdLine, "Z:\\home\\me\\Games\\Factorio\\bin\\x64\\factorio.exe --fullscreen");
    assert.equal(deleted.path, "/home/me/game/run");
    assert.equal(match.linuxProcess(303, null, ""), null);
    const games = match.matchGames([native, wine, deleted], index, "linux");
    assert.deepEqual(
        games.map((game) => [game.pid, game.name]),
        [[300, "Factorio"]],
    );
    assert.deepEqual(
        match.listCandidates([native, wine, deleted, { pid: 5, path: "/usr/bin/bash" }], games, "linux", { home: "/home/me", index }).map((game) => game.name),
        ["run"],
    );
});

test("user added games match by path and keep their name, and each game is reported once", () => {
    const index = match.buildGameIndex(LIST, "win32");
    const processes = [
        { pid: 9, path: "C:\\Games\\Indie\\Indie.exe" },
        { pid: 10, path: "C:\\Games\\Factorio\\factorio.exe" },
        { pid: 11, path: "C:\\Games\\Factorio\\factorio.exe" },
    ];
    const overrides = match.cleanOverrides([{ exePath: "c:/games/indie/indie.exe", name: "My Indie Game", add: true }, { exePath: 3 }, { name: "x" }]);
    assert.deepEqual(overrides, [{ exePath: "c:/games/indie/indie.exe", name: "My Indie Game" }]);
    const games = match.matchGames(processes, index, "win32", overrides);
    assert.deepEqual(
        games.map((game) => [game.pid, game.id, game.name]),
        [
            [9, undefined, "My Indie Game"],
            [10, "358422126602223616", "Factorio"],
        ],
    );
    assert.ok(match.sameGames(games, structuredClone(games)));
    assert.ok(!match.sameGames(games, games.slice(1)));
});

test("macOS candidates are app bundles outside the system and the app itself", () => {
    const processes = [
        { pid: 1, path: "/Applications/Indie Game.app/Contents/MacOS/Indie Game" },
        { pid: 2, path: "/System/Applications/Mail.app/Contents/MacOS/Mail" },
        { pid: 3, path: "/Applications/Discord OSS.app/Contents/MacOS/Discord OSS" },
        { pid: 4, path: "/Applications/Indie Game.app/Contents/Frameworks/Helper.app/Contents/MacOS/Helper" },
        { pid: 5, path: "/usr/sbin/cfprefsd" },
    ];
    assert.deepEqual(
        match.listCandidates(processes, [], "darwin", { ignore: ["/Applications/Discord OSS.app"] }).map((game) => game.name),
        ["Indie Game"],
    );
});

test("the Windows reader script quotes argument names and watches its parent", () => {
    const script = windowsScript(new Set(["javaw.exe", "bad'name"]), 1234);
    assert.ok(script.includes("$argNames = @('javaw.exe')"));
    assert.ok(script.includes("Get-Process -Id 1234"));
    assert.ok(script.includes("Start-Sleep -Seconds 15"));
});

test("Steam games without a listed executable match their steamapps folder on macOS and Linux", () => {
    const list = [...LIST, { id: "373301838051033088", name: "Geometry Dash", aliases: ["GD"], executables: [{ name: "geometrydash.exe", os: "win32" }] }];
    const mac = match.buildGameIndex(list, "darwin");
    const steam = "/Users/me/Library/Application Support/Steam/steamapps/common/Geometry Dash/Geometry Dash.app/Contents/MacOS/Geometry Dash";
    assert.equal(match.findGame({ pid: 1, path: steam }, mac, "darwin")?.name, "Geometry Dash");
    assert.equal(match.findGame({ pid: 2, path: steam.replace("MacOS/Geometry Dash", "Frameworks/Helper.app/Contents/MacOS/Helper") }, mac, "darwin"), undefined);
    assert.equal(
        match.findGame({ pid: 3, path: "/Users/me/Library/Application Support/Steam/steamapps/common/Unknown Tool/Tool.app/Contents/MacOS/Tool" }, mac, "darwin"),
        undefined,
    );
    const linux = match.buildGameIndex(list, "linux");
    assert.equal(match.findGame({ pid: 4, path: "/home/me/.steam/steam/steamapps/common/Geometry Dash/run" }, linux, "linux")?.id, "373301838051033088");
    const windows = match.buildGameIndex(list, "win32");
    assert.equal(match.findGame({ pid: 5, path: "C:\\Steam\\steamapps\\common\\Geometry Dash\\launcher.exe" }, windows, "win32"), undefined);
    assert.equal(match.compactName("Baldur's Gate 3"), "baldursgate3");
});

test("nested app bundles and helpers are not separate macOS candidates", () => {
    const processes = match.parsePsList(
        [
            "1 /Applications/Firefox.app/Contents/MacOS/firefox",
            "2 /Applications/Firefox.app/Contents/MacOS/crashhelper",
            "3 /Applications/Firefox.app/Contents/MacOS/plugin-container.app/Contents/MacOS/plugin-container",
        ].join("\n"),
    );
    assert.deepEqual(
        match.listCandidates(processes, [], "darwin").map((game) => [game.pid, game.name]),
        [[1, "Firefox"]],
    );
});
