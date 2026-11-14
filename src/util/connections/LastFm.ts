import crypto from "node:crypto";

export const LASTFM_API = "https://ws.audioscrobbler.com/2.0/";
const PLACEHOLDER_IMAGE = "2a96cbd8b46e442fc41c2b86b821562f";

export interface LastFmTrack {
    title: string;
    artist: string;
    album?: string;
    url?: string;
    artwork_url?: string;
}

type LastFmText = { "#text"?: unknown; name?: unknown } | string | undefined;
type LastFmImage = { size?: unknown; "#text"?: unknown };

export function lastFmSignature(params: Record<string, string>, secret: string) {
    const base = Object.keys(params)
        .filter((key) => key !== "format" && key !== "callback")
        .sort()
        .map((key) => `${key}${params[key]}`)
        .join("");
    return crypto
        .createHash("md5")
        .update(base + secret, "utf8")
        .digest("hex");
}

const text = (value: LastFmText, max: number) => {
    const raw = typeof value === "string" ? value : typeof value?.["#text"] === "string" ? value["#text"] : typeof value?.name === "string" ? value.name : undefined;
    const trimmed = raw?.trim();
    return trimmed ? trimmed.slice(0, max) : undefined;
};

const httpsUrl = (value: unknown, hosts: RegExp) => {
    if (typeof value !== "string" || value.length > 512) return undefined;
    try {
        const url = new URL(value);
        return url.protocol === "https:" && hosts.test(url.hostname) ? url.href : undefined;
    } catch {
        return undefined;
    }
};

const IMAGE_SIZES = ["extralarge", "large", "medium", "small"];

function artwork(images: unknown) {
    if (!Array.isArray(images)) return undefined;
    const sorted = [...(images as LastFmImage[])].sort((a, b) => IMAGE_SIZES.indexOf(String(a.size)) - IMAGE_SIZES.indexOf(String(b.size)));
    for (const image of sorted) {
        const url = httpsUrl(image["#text"], /(^|\.)(last\.fm|lastfm\.freetls\.fastly\.net|fastly\.net)$/i);
        if (url && !url.includes(PLACEHOLDER_IMAGE)) return url;
    }
    return undefined;
}

export function nowPlayingFromRecentTracks(body: unknown): LastFmTrack | null {
    const tracks = (body as { recenttracks?: { track?: unknown } })?.recenttracks?.track;
    const first = (Array.isArray(tracks) ? tracks[0] : tracks) as Record<string, unknown> | undefined;
    if (!first || (first["@attr"] as { nowplaying?: unknown } | undefined)?.nowplaying !== "true") return null;
    const title = text(first.name as LastFmText, 256);
    const artist = text(first.artist as LastFmText, 256);
    if (!title || !artist) return null;
    return {
        title,
        artist,
        album: text(first.album as LastFmText, 256),
        url: httpsUrl(first.url, /(^|\.)last\.fm$/i),
        artwork_url: artwork(first.image),
    };
}

export function durationFromTrackInfo(body: unknown) {
    const duration = Number((body as { track?: { duration?: unknown } })?.track?.duration);
    return Number.isFinite(duration) && duration > 0 && duration < 86_400_000 ? Math.round(duration) : undefined;
}

export interface LastFmNowPlaying extends LastFmTrack {
    duration_ms?: number;
    since: number;
}

export type LastFmFetch = (url: string) => Promise<unknown>;

const RECENT_TTL_MS = 10_000;
const MAX_USERS = 2000;
const MAX_TRACKS = 1000;
const recent = new Map<string, { at: number; result: Promise<LastFmNowPlaying | null> }>();
const started = new Map<string, { key: string; since: number }>();
const durations = new Map<string, Promise<number | undefined>>();

function remember<V>(map: Map<string, V>, key: string, value: V, max: number) {
    map.delete(key);
    map.set(key, value);
    while (map.size > max) map.delete(map.keys().next().value as string);
}

export const lastFmUserAgent = "instance-connections";

class LastFmStatusError extends Error {}

export const lastFmFetch: LastFmFetch = async (url) => {
    const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": lastFmUserAgent }, redirect: "error", signal: AbortSignal.timeout(8000) });
    const body = await res.json().catch(() => null);
    if (!res.ok && !(body && typeof body === "object" && "error" in body)) throw new LastFmStatusError(`Last.fm answered ${res.status}`);
    return body;
};

const apiUrl = (params: Record<string, string>) => `${LASTFM_API}?${new URLSearchParams({ ...params, format: "json" })}`;

function trackDuration(track: LastFmTrack, apiKey: string, fetchJson: LastFmFetch) {
    const key = `${track.artist.toLowerCase()}\n${track.title.toLowerCase()}`;
    const cached = durations.get(key);
    if (cached) return cached;
    const result = fetchJson(apiUrl({ method: "track.getInfo", api_key: apiKey, artist: track.artist, track: track.title, autocorrect: "1" }))
        .then(durationFromTrackInfo)
        .catch(() => undefined);
    remember(durations, key, result, MAX_TRACKS);
    return result;
}

async function readNowPlaying(username: string, apiKey: string, fetchJson: LastFmFetch, now: () => number): Promise<LastFmNowPlaying | null> {
    const body = await fetchJson(apiUrl({ method: "user.getRecentTracks", user: username, api_key: apiKey, limit: "1" }));
    const track = nowPlayingFromRecentTracks(body);
    const user = username.toLowerCase();
    if (!track) {
        started.delete(user);
        return null;
    }
    const key = `${track.artist}\n${track.title}`;
    const previous = started.get(user);
    const since = previous?.key === key ? previous.since : now();
    remember(started, user, { key, since }, MAX_USERS);
    const duration_ms = await trackDuration(track, apiKey, fetchJson);
    return { ...track, ...(duration_ms ? { duration_ms } : {}), since };
}

export function lastFmNowPlaying(username: string, apiKey: string, fetchJson: LastFmFetch = lastFmFetch, now: () => number = Date.now) {
    const user = username.toLowerCase();
    const cached = recent.get(user);
    if (cached && now() - cached.at < RECENT_TTL_MS) return cached.result;
    const result = readNowPlaying(username, apiKey, fetchJson, now).catch((error) => {
        console.warn(`[Last.fm] now playing lookup failed: ${error instanceof LastFmStatusError ? error.message : "no answer"}`);
        return null;
    });
    remember(recent, user, { at: now(), result }, MAX_USERS);
    return result;
}

export function resetLastFmCache() {
    recent.clear();
    started.clear();
    durations.clear();
}
