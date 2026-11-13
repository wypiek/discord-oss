import type { MusicTrack } from "./music-types";

const DRIFT_MS = 3000;

const startedAt = (track: MusicTrack) => track.updatedAt - (track.position ?? 0);

export function trackChanged(previous: MusicTrack | undefined, next: MusicTrack | undefined) {
    if (!previous || !next) return previous !== next;
    if (previous.title !== next.title || previous.artist !== next.artist || previous.url !== next.url || previous.paused !== next.paused) return true;
    if (previous.artworkUrl !== next.artworkUrl || previous.duration !== next.duration) return true;
    if (next.paused) return Math.abs((previous.position ?? 0) - (next.position ?? 0)) > DRIFT_MS;
    return Math.abs(startedAt(previous) - startedAt(next)) > DRIFT_MS;
}

const parseUrl = (url: string | undefined) => {
    try {
        return url ? new URL(url) : null;
    } catch {
        return null;
    }
};

export const isSoundCloudUrl = (url: string | undefined) => {
    const parsed = parseUrl(url);
    return !!parsed && parsed.protocol === "https:" && (parsed.hostname === "soundcloud.com" || parsed.hostname.endsWith(".soundcloud.com"));
};

export const isHttpsHost = (url: string | undefined, hosts: string[]) => {
    const parsed = parseUrl(url);
    return !!parsed && parsed.protocol === "https:" && hosts.includes(parsed.hostname);
};

const text = (value: unknown, max: number) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined);
const millis = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 86_400_000 ? Math.round(value) : undefined);

export function soundCloudTrack(input: unknown, now = Date.now()): MusicTrack | null {
    if (!input || typeof input !== "object") return null;
    const state = input as Record<string, unknown>;
    const title = text(state.title, 256);
    if (!title) return null;
    const url = text(state.url, 512);
    const artworkUrl = text(state.artworkUrl, 512);
    return {
        source: "soundcloud",
        title,
        artist: text(state.artist, 256) ?? "",
        url: url && isSoundCloudUrl(url) ? url : undefined,
        artworkUrl: artworkUrl && /^https:\/\/[a-z0-9-]+\.sndcdn\.com\//i.test(artworkUrl) ? artworkUrl : undefined,
        duration: millis(state.duration),
        position: millis(state.position),
        paused: state.paused !== false,
        updatedAt: now,
    };
}
