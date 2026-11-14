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
