import type { DetectableEntry, DetectedGame, GameOverride, GamePlatform, RunningProcess } from "./game-types";

interface IndexedExecutable {
    game: number;
    exact: boolean;
    arguments?: string;
}

export interface GameIndex {
    games: { id: string; name: string }[];
    executables: Map<string, IndexedExecutable[]>;
    argumentNames: Set<string>;
    names: Map<string, number>;
}

const MAX_SUFFIX_SEGMENTS = 8;
const MAX_CANDIDATES = 100;

const PLATFORM_OSES: Record<GamePlatform, string[]> = {
    darwin: ["darwin"],
    win32: ["win32"],
    linux: ["linux", "win32"],
};

const text = (value: unknown, max: number) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined);

export const normalizeExecutableName = (name: string) => name.trim().toLowerCase().replace(/\\/g, "/").replace(/^\/+/, "");

export function pathSegments(path: string) {
    const segments = path
        .replace(/^file:\/\//i, "")
        .toLowerCase()
        .replace(/\\/g, "/")
        .split("/")
        .filter(Boolean);
    if (segments.length && /^[a-z]:$/.test(segments[0])) segments.shift();
    return segments;
}

export function appBundleEnd(segments: string[]) {
    const index = segments.findIndex((segment) => segment.endsWith(".app"));
    return index >= 0 && segments[index + 1] === "contents" && segments[index + 2] === "macos" && index + 4 === segments.length ? index : -1;
}

export const compactName = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

function steamFolder(segments: string[]) {
    for (let index = 0; index < segments.length - 3; index++) {
        if (segments[index] === "steamapps" && segments[index + 1] === "common") return segments[index + 2];
    }
    return undefined;
}

const suffixes = (segments: string[]) => {
    const keys: string[] = [];
    for (let count = 1; count <= Math.min(segments.length, MAX_SUFFIX_SEGMENTS); count++) keys.push(segments.slice(-count).join("/"));
    return keys;
};

export function buildGameIndex(list: unknown, platform: GamePlatform): GameIndex {
    const oses = PLATFORM_OSES[platform];
    const index: GameIndex = { games: [], executables: new Map(), argumentNames: new Set(), names: new Map() };
    if (!Array.isArray(list)) return index;
    for (const raw of list.slice(0, 60_000) as DetectableEntry[]) {
        const id = text(raw?.id, 32);
        const name = text(raw?.name, 128);
        if (!id || !/^\d+$/.test(id) || !name) continue;
        const game = index.games.length;
        index.games.push({ id, name });
        for (const alias of [name, ...(Array.isArray(raw.aliases) ? raw.aliases.slice(0, 16) : [])]) {
            const key = typeof alias === "string" ? compactName(alias) : "";
            if (key.length >= 3 && !index.names.has(key)) index.names.set(key, game);
        }
        for (const executable of (Array.isArray(raw.executables) ? raw.executables : []).slice(0, 64)) {
            const rawName = text(executable?.name, 260);
            if (!rawName || executable.is_launcher === true) continue;
            if (executable.os && !oses.includes(executable.os)) continue;
            const exact = rawName.startsWith(">");
            const key = normalizeExecutableName(exact ? rawName.slice(1) : rawName);
            if (!key) continue;
            const args = text(executable.arguments, 260);
            const entries = index.executables.get(key) ?? [];
            entries.push({ game, exact, ...(args && { arguments: args }) });
            index.executables.set(key, entries);
            if (args) index.argumentNames.add(key.split("/").pop() ?? key);
        }
    }
    return index;
}

function lookupKeys(segments: string[], platform: GamePlatform) {
    const keys = suffixes(segments);
    if (platform === "darwin") {
        const bundle = appBundleEnd(segments);
        if (bundle >= 0) keys.push(...suffixes(segments.slice(0, bundle + 1)));
    }
    return keys;
}

export function findGame(process: RunningProcess, index: GameIndex, platform: GamePlatform) {
    const segments = pathSegments(process.path);
    if (!segments.length) return undefined;
    const base = segments[segments.length - 1];
    for (const key of lookupKeys(segments, platform)) {
        for (const entry of index.executables.get(key) ?? []) {
            if (entry.exact && key !== base) continue;
            if (entry.arguments && !process.cmdLine?.includes(entry.arguments)) continue;
            return index.games[entry.game];
        }
    }
    if (platform === "win32") return undefined;
    const folder = steamFolder(segments);
    if (!folder || (platform === "darwin" && appBundleEnd(segments) < 0)) return undefined;
    const game = index.names.get(compactName(folder));
    return game === undefined ? undefined : index.games[game];
}

export function needsCommandLine(path: string, index: GameIndex) {
    const segments = pathSegments(path);
    return segments.length > 0 && index.argumentNames.has(segments[segments.length - 1]);
}

const displayPath = (path: string, platform: GamePlatform) => (platform === "win32" ? path.replace(/\\/g, "/").toLowerCase() : path);

const comparablePath = (path: string) => path.replace(/\\/g, "/").toLowerCase();

const exeName = (path: string) => path.replace(/\\/g, "/").split("/").pop() ?? path;

function detected(process: RunningProcess, platform: GamePlatform, name: string, id?: string): DetectedGame {
    return { pid: process.pid, ...(id && { id }), name, exePath: displayPath(process.path, platform), exeName: exeName(process.path), cmdLine: "" };
}

export function cleanOverrides(input: unknown): GameOverride[] {
    if (!Array.isArray(input)) return [];
    return input.slice(0, 500).flatMap((raw: Partial<GameOverride>) => {
        const exePath = text(raw?.exePath, 1024);
        const name = text(raw?.name, 128);
        const id = text(raw?.id, 32);
        return exePath && name ? [{ exePath, name, ...(id && /^\d+$/.test(id) && { id }) }] : [];
    });
}

export function matchGames(processes: RunningProcess[], index: GameIndex, platform: GamePlatform, overrides: GameOverride[] = []) {
    const byPath = new Map(overrides.map((override) => [comparablePath(override.exePath), override]));
    const games: DetectedGame[] = [];
    const seen = new Set<string>();
    for (const process of [...processes].sort((a, b) => a.pid - b.pid)) {
        if (!process.path) continue;
        const override = byPath.get(comparablePath(process.path));
        const game = override ? { id: override.id, name: override.name } : findGame(process, index, platform);
        if (!game) continue;
        const key = game.id ?? `name:${game.name.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        games.push(detected(process, platform, game.name, game.id));
    }
    return games;
}

function candidateName(process: RunningProcess, platform: GamePlatform, home: string) {
    const segments = process.path.replace(/\\/g, "/").split("/").filter(Boolean);
    const lower = comparablePath(process.path);
    if (platform === "darwin") {
        const bundle = appBundleEnd(pathSegments(process.path));
        if (bundle < 0 || /^\/(system|usr|library\/apple)\//.test(lower) || lower.includes("/contents/frameworks/")) return undefined;
        return segments[bundle].replace(/\.app$/i, "");
    }
    const base = segments[segments.length - 1] ?? "";
    if (platform === "win32") {
        if (!process.windowed || /^[a-z]:\/windows\//.test(lower)) return undefined;
        return base.replace(/\.exe$/i, "");
    }
    const homeDir = home ? `${comparablePath(home).replace(/\/$/, "")}/` : "";
    if (!(lower.endsWith(".exe") || lower.startsWith("/opt/") || lower.startsWith("/usr/games/") || (homeDir && lower.startsWith(homeDir)))) return undefined;
    return base.replace(/\.exe$/i, "");
}

export function listCandidates(
    processes: RunningProcess[],
    games: DetectedGame[],
    platform: GamePlatform,
    { home = "", ignore = [] as string[], index = undefined as GameIndex | undefined } = {},
) {
    const taken = new Set(games.map((game) => game.pid));
    const ignored = ignore.map(comparablePath);
    const candidates = new Map<string, DetectedGame>();
    for (const process of [...processes].sort((a, b) => a.pid - b.pid)) {
        if (!process.path || taken.has(process.pid)) continue;
        const path = comparablePath(process.path);
        if (ignored.some((prefix) => path.startsWith(prefix)) || (index && findGame(process, index, platform))) continue;
        const name = candidateName(process, platform, home);
        const key = platform === "darwin" ? `${name}:${path.slice(0, path.indexOf(".app/") + 4)}` : path;
        if (name && !candidates.has(key)) candidates.set(key, detected(process, platform, name));
    }
    return [...candidates.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, MAX_CANDIDATES);
}

export function parsePsList(output: string): RunningProcess[] {
    return output.split("\n").flatMap((line) => {
        const match = /^\s*(\d+)\s+(.+?)\s*$/.exec(line);
        return match ? [{ pid: Number(match[1]), path: match[2] }] : [];
    });
}

export function parsePsArguments(output: string) {
    const args = new Map<number, string>();
    for (const line of output.split("\n")) {
        const match = /^\s*(\d+)\s+(.*?)\s*$/.exec(line);
        if (match) args.set(Number(match[1]), match[2]);
    }
    return args;
}

export function parseWindowsProcesses(line: string): RunningProcess[] | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(line);
    } catch {
        return null;
    }
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.flatMap((row: { i?: unknown; p?: unknown; w?: unknown; c?: unknown }) => {
        if (typeof row?.i !== "number" || typeof row.p !== "string" || !row.p) return [];
        return [{ pid: row.i, path: row.p, windowed: row.w === 1 || row.w === true, ...(typeof row.c === "string" && row.c && { cmdLine: row.c }) }];
    });
}

export function linuxProcess(pid: number, exe: string | null, cmdline: string): RunningProcess | null {
    const argv = cmdline.split("\0").filter(Boolean);
    const first = argv[0] ?? "";
    const wine = /\.exe$/i.test(first) && /^[a-z]:\\|\\/i.test(first);
    const path = wine ? first : exe?.replace(/ \(deleted\)$/, "") || first;
    if (!path) return null;
    return { pid, path, cmdLine: argv.join(" ") };
}

export function sameGames(previous: DetectedGame[] | undefined, next: DetectedGame[]) {
    if (!previous || previous.length !== next.length) return false;
    return previous.every((game, index) => game.pid === next[index].pid && game.id === next[index].id && game.name === next[index].name && game.exePath === next[index].exePath);
}
