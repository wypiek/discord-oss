import { homedir } from "node:os";
import { dirname } from "node:path";
import { app, ipcMain, type WebContents } from "electron";
import { createGameListLoader } from "./game-list";
import { cleanOverrides, type GameIndex, listCandidates, matchGames, sameGames } from "./game-match";
import { createProcessWatcher } from "./game-processes";
import type { GameOverride, GamePlatform, GamesUpdate, RunningProcess } from "./game-types";

interface GamesOptions {
    allowed(url: string | undefined): boolean;
}

interface Watcher {
    origin: string;
    overrides: GameOverride[];
    candidates: boolean;
    sent?: GamesUpdate;
}

const PLATFORMS: string[] = ["darwin", "win32", "linux"];

function ownInstallPath() {
    const exe = app.getPath("exe");
    if (process.platform !== "darwin") return dirname(exe);
    const bundle = exe.indexOf(".app/");
    return bundle >= 0 ? exe.slice(0, bundle + 4) : dirname(exe);
}

export function registerGames({ allowed }: GamesOptions) {
    const platform = PLATFORMS.includes(process.platform) ? (process.platform as GamePlatform) : null;
    const processWatcher = platform ? createProcessWatcher() : null;
    const loader = platform ? createGameListLoader(platform) : null;
    const watchers = new Map<WebContents, Watcher>();
    const hooked = new WeakSet<WebContents>();
    const indexes = new Map<string, GameIndex>();
    let processes: RunningProcess[] = [];
    let running = false;

    const publish = () => {
        if (!platform) return;
        for (const [contents, watcher] of watchers) {
            if (contents.isDestroyed()) {
                forget(contents);
                continue;
            }
            const index = indexes.get(watcher.origin);
            if (!index) continue;
            const games = matchGames(processes, index, platform, watcher.overrides);
            const candidates = watcher.candidates ? listCandidates(processes, games, platform, { home: homedir(), ignore: [ownInstallPath()], index }) : [];
            if (watcher.sent && sameGames(watcher.sent.games, games) && sameGames(watcher.sent.candidates, candidates)) continue;
            watcher.sent = { games, candidates };
            contents.send("games:update", watcher.sent);
        }
    };

    const update = () => {
        if (!processWatcher) return;
        const ready = [...watchers.values()].map((watcher) => indexes.get(watcher.origin)).filter((index): index is GameIndex => !!index);
        if (ready.length) {
            running = true;
            processWatcher.start(new Set(ready.flatMap((index) => [...index.argumentNames])), (next) => {
                processes = next;
                publish();
            });
        } else if (running) {
            running = false;
            processWatcher.stop();
            processes = [];
        }
    };

    const forget = (contents: WebContents) => {
        watchers.delete(contents);
        update();
    };

    const hook = (contents: WebContents) => {
        if (hooked.has(contents)) return;
        hooked.add(contents);
        contents.once("destroyed", () => forget(contents));
        contents.on("did-start-navigation", (details) => {
            if (details.isMainFrame && !details.isSameDocument) forget(contents);
        });
    };

    const loadIndex = (origin: string) => {
        loader?.load(origin).then((index) => {
            if (!index || indexes.get(origin) === index) return;
            indexes.set(origin, index);
            update();
            publish();
        });
    };

    ipcMain.on("games:watch", (event, input: unknown) => {
        const url = event.senderFrame?.url;
        if (!platform || !allowed(url)) return;
        const contents = event.sender;
        if (!input || typeof input !== "object") {
            forget(contents);
            return;
        }
        const request = input as Record<string, unknown>;
        const origin = new URL(url as string).origin;
        const previous = watchers.get(contents);
        const candidates = request.candidates === true;
        watchers.set(contents, { origin, overrides: cleanOverrides(request.overrides), candidates, sent: previous?.origin === origin ? previous.sent : undefined });
        hook(contents);
        loadIndex(origin);
        update();
        if (candidates && !previous?.candidates) processWatcher?.scanNow();
        publish();
    });

    return {
        stop() {
            processWatcher?.stop();
            running = false;
        },
    };
}
