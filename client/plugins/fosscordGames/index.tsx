import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher } from "@webpack/common";

import { FosscordAuthor } from "../fosscordCore/shared";

interface BridgeGame {
    pid: number;
    id?: string;
    name: string;
    exePath: string;
    exeName: string;
    cmdLine: string;
}

interface GamesUpdate {
    games: BridgeGame[];
    candidates: BridgeGame[];
}

interface GameOverride {
    exePath: string;
    name: string;
    id?: string;
}

interface GamesBridge {
    watch(options: { overrides: GameOverride[]; candidates: boolean } | null): void;
    onUpdate(listener: (update: GamesUpdate) => void): () => void;
}

type ObservedGamesCallback = (games: RunningGame[]) => void;

interface RunningGame {
    id?: string;
    nativeProcessObserverId?: number;
    name: string;
    origGameName: string;
    processName: string;
    hidden: boolean;
    elevated: boolean;
    sandboxed: boolean;
    lastFocused: number;
    exePath: string;
    exeName: string;
    cmdLine: string;
    pid: number;
    pidPath: number[];
    windowHandle: null;
    fullscreenType: number;
    isLauncher: boolean;
}

const UNKNOWN_FULLSCREEN_TYPE = 0;

let observedCallback: ObservedGamesCallback | null = null;
let overrides: GameOverride[] = [];
let candidateWatchers = 0;
let unsubscribe: (() => void) | null = null;
let running = false;
let lastGames: RunningGame[] = [];

const bridge = (): GamesBridge | undefined => {
    const desktop = (window as unknown as { DiscordOSS?: { games?: GamesBridge }; DiscordNative?: unknown }).DiscordOSS;
    return (window as unknown as { DiscordNative?: unknown }).DiscordNative ? undefined : desktop?.games;
};

const settings = definePluginSettings({
    detectGames: {
        type: OptionType.BOOLEAN,
        description: "Detect the games you play with the desktop app, for Registered Games and your Playing activity",
        default: true,
        onChange: () => rewatch(),
    },
});

const cleanOverride = (raw: Partial<GameOverride> | null | undefined): GameOverride[] =>
    typeof raw?.exePath === "string" && typeof raw.name === "string" ? [{ exePath: raw.exePath, name: raw.name, ...(typeof raw.id === "string" && { id: raw.id }) }] : [];

function rewatch(): void {
    const games = bridge();
    if (!games) return;
    const active = running && settings.store.detectGames && !!observedCallback;
    games.watch(active ? { overrides, candidates: candidateWatchers > 0 } : null);
    if (!active && lastGames.length) deliver([]);
}

function toRunningGame(game: BridgeGame, now: number): RunningGame {
    return {
        ...(game.id && { id: game.id, nativeProcessObserverId: game.pid }),
        name: game.name,
        origGameName: game.name,
        processName: game.exeName,
        hidden: false,
        elevated: false,
        sandboxed: false,
        lastFocused: now,
        exePath: game.exePath,
        exeName: game.exeName,
        cmdLine: game.cmdLine ?? "",
        pid: game.pid,
        pidPath: [],
        windowHandle: null,
        fullscreenType: UNKNOWN_FULLSCREEN_TYPE,
        isLauncher: false,
    };
}

function deliver(games: RunningGame[]): void {
    lastGames = games;
    observedCallback?.(games);
}

function onUpdate(update: GamesUpdate): void {
    if (!running || !settings.store.detectGames) return;
    const now = Math.floor(Date.now() / 1000);
    deliver((Array.isArray(update?.games) ? update.games : []).map((game) => toRunningGame(game, now)));
    if (candidateWatchers > 0)
        FluxDispatcher.dispatch({
            type: "CANDIDATE_GAMES_CHANGE",
            games: (Array.isArray(update?.candidates) ? update.candidates : []).map((game) => ({ ...toRunningGame(game, now), hidden: true })),
        });
}

const nativeAdapter = {
    setObservedGamesCallback(_games: unknown, _v2: unknown, callback: ObservedGamesCallback) {
        observedCallback = callback;
        rewatch();
    },
    setGameDetectionCallback() {},
    setGameDetectionErrorCallback() {},
    setGameCandidateOverrides(list: Partial<GameOverride>[]) {
        overrides = (Array.isArray(list) ? list : []).flatMap(cleanOverride);
        rewatch();
    },
};

export default definePlugin({
    name: "FosscordGames",
    description: "Shows the games the desktop app detects as your Playing activity and lists them under Registered Games, the way the official desktop app does.",
    authors: [FosscordAuthor],
    required: true,
    settings,

    patches: [
        {
            find: 'return this.requireModule("discord_utils")',
            replacement: {
                match: /getDiscordUtils\(\)\{/,
                replace: "$&if($self.bridged())return{};",
            },
        },
        {
            find: 'displayName="RunningGameStore"',
            replacement: [
                {
                    match: /if\((\i)\)(\{let \i=function\(\)\{let \i=\[\],\i=new Set;)/,
                    replace: "if($1||$self.bridged())$2",
                },
                {
                    match: /(if\(!__OVERLAY__&&)(\i\.isPlatformEmbedded)(\)\{let \i=\[\.\.\.\i,)/,
                    replace: "$1($2||$self.bridged())$3",
                },
                {
                    match: /(\i\.\i)\.(setObservedGamesCallback|setGameDetectionCallback|setGameDetectionErrorCallback|setGameCandidateOverrides)\(/g,
                    replace: "$self.native($1).$2(",
                },
            ],
        },
        {
            find: "GameProfileTrackActionActions.ClaimGame",
            replacement: {
                match: /(\i\.linkedApplications\?\.some\(\i=>\i\.type===\i\.\i\.OFFICIAL\))\?null:/,
                replace: "$1||!0?null:",
            },
        },
        {
            find: '"registered-game-overflow-menu"',
            replacement: [
                {
                    match: /(\.REGISTERED_GAMES_SIDEBAR_ITEM,\{.{0,200}?usePredicate:)(\i\.\i)/,
                    replace: "$1()=>$self.bridged()||$2()",
                },
                {
                    match: /if\((\i)\.isPlatformEmbedded\)return\(0,(\i)\.a2\)\(\),\2\.e0/,
                    replace: "$&;if($self.bridged())return $self.watchCandidates()",
                },
            ],
        },
    ],

    bridged() {
        return !!bridge();
    },

    native(native: unknown) {
        return bridge() ? nativeAdapter : native;
    },

    watchCandidates() {
        candidateWatchers++;
        rewatch();
        return () => {
            candidateWatchers = Math.max(0, candidateWatchers - 1);
            rewatch();
        };
    },

    start() {
        const games = bridge();
        if (!games) return;
        running = true;
        unsubscribe = games.onUpdate(onUpdate);
        rewatch();
    },

    stop() {
        running = false;
        rewatch();
        unsubscribe?.();
        unsubscribe = null;
    },
});
