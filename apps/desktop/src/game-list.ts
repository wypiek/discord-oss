import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, net } from "electron";
import { buildGameIndex, type GameIndex } from "./game-match";
import type { GamePlatform } from "./game-types";

const REFRESH_MS = 12 * 3_600_000;
const RETRY_MS = 10 * 60_000;

interface CachedList {
    etag: string | null;
    fetchedAt: number;
    list: unknown;
}

interface WellKnown {
    api?: { url?: string; default_version?: string };
}

async function listUrl(origin: string, platform: GamePlatform) {
    const response = await net.fetch(`${origin}/.well-known/discord-oss`, { headers: { accept: "application/json" } });
    const body = response.ok ? ((await response.json().catch(() => null)) as WellKnown | null) : null;
    const api = body?.api?.url ? new URL(body.api.url) : new URL("/api", origin);
    const version = /^\d+$/.test(body?.api?.default_version ?? "") ? body?.api?.default_version : "9";
    return `${api.origin}${api.pathname.replace(/\/$/, "")}/v${version}/games/detectable/executables?os=${platform}`;
}

async function readCache(file: string): Promise<CachedList | null> {
    try {
        const cached = JSON.parse(await readFile(file, "utf8")) as CachedList;
        return Array.isArray(cached?.list) && typeof cached.fetchedAt === "number" ? cached : null;
    } catch {
        return null;
    }
}

export function createGameListLoader(platform: GamePlatform) {
    const indexes = new Map<string, { index: Promise<GameIndex | null>; expires: number }>();

    async function load(origin: string): Promise<GameIndex | null> {
        const folder = join(app.getPath("userData"), "games");
        const file = join(folder, `${createHash("sha1").update(origin).digest("hex").slice(0, 16)}-${platform}.json`);
        const cached = await readCache(file);
        if (cached && Date.now() - cached.fetchedAt < REFRESH_MS) return buildGameIndex(cached.list, platform);
        try {
            const response = await net.fetch(await listUrl(origin, platform), { headers: cached?.etag ? { "if-none-match": cached.etag } : {} });
            if (response.status === 304 && cached) {
                await writeFile(file, JSON.stringify({ ...cached, fetchedAt: Date.now() })).catch(() => {});
                return buildGameIndex(cached.list, platform);
            }
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const list = (await response.json()) as unknown;
            if (!Array.isArray(list)) throw new Error("not a list");
            await mkdir(folder, { recursive: true });
            await writeFile(file, JSON.stringify({ etag: response.headers.get("etag"), fetchedAt: Date.now(), list } satisfies CachedList)).catch(() => {});
            return buildGameIndex(list, platform);
        } catch {
            return cached ? buildGameIndex(cached.list, platform) : null;
        }
    }

    return {
        load(origin: string) {
            const current = indexes.get(origin);
            if (current && current.expires > Date.now()) return current.index;
            const index = load(origin);
            const entry = { index, expires: Date.now() + REFRESH_MS };
            indexes.set(origin, entry);
            index.then((result) => {
                if (!result) entry.expires = Date.now() + RETRY_MS;
            });
            return index;
        },
    };
}
