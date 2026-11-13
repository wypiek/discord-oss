import { ipcRenderer } from "electron";

interface PlayerState {
    title: string;
    artist: string;
    artworkUrl?: string;
    url?: string;
    duration?: number;
    position?: number;
    paused: boolean;
}

const POLL_MS = 1000;
const HEARTBEAT_MS = 30_000;
const DRIFT_MS = 3000;

const clock = (text: string | null | undefined) => {
    const parts = (text ?? "").trim().split(":").map(Number);
    if (!parts.length || parts.some((part) => !Number.isFinite(part))) return undefined;
    return parts.reduce((total, part) => total * 60 + part, 0) * 1000;
};

const attribute = (selector: string, name: string) => document.querySelector(selector)?.getAttribute(name)?.trim() || undefined;

const visibleText = (selector: string) => document.querySelector(`${selector} span[aria-hidden="true"]`)?.textContent ?? document.querySelector(selector)?.textContent;

function artwork() {
    const image = document.querySelector<HTMLElement>(".playControls .playbackSoundBadge__avatar span.sc-artwork, .playControls .playbackSoundBadge span.sc-artwork");
    const css = image ? getComputedStyle(image).backgroundImage : "";
    const url = /url\("?(https:\/\/[^")]+)"?\)/.exec(css)?.[1];
    if (url) return url.replace(/-t\d+x\d+\./, "-t500x500.");
    const fromSession = navigator.mediaSession?.metadata?.artwork?.at(-1)?.src;
    return fromSession?.startsWith("https://") ? fromSession : undefined;
}

function trackUrl() {
    const href = attribute(".playControls a.playbackSoundBadge__titleLink", "href");
    if (!href) return undefined;
    const url = new URL(href, location.origin);
    url.search = "";
    url.hash = "";
    return url.toString();
}

function read(): PlayerState | null {
    const metadata = navigator.mediaSession?.metadata;
    const title = attribute(".playControls a.playbackSoundBadge__titleLink", "title") ?? metadata?.title;
    if (!title) return null;
    const artist = attribute(".playControls a.playbackSoundBadge__lightLink", "title") ?? metadata?.artist ?? "";
    const progress = document.querySelector(".playControls .playbackTimeline__progressWrapper");
    const max = Number(progress?.getAttribute("aria-valuemax"));
    const now = Number(progress?.getAttribute("aria-valuenow"));
    const duration = clock(visibleText(".playControls .playbackTimeline__duration")) ?? (max > 0 ? max * 1000 : undefined);
    const position = clock(visibleText(".playControls .playbackTimeline__timePassed")) ?? (now >= 0 ? now * 1000 : undefined);
    const playing = document.querySelector(".playControls button.playControls__play")?.classList.contains("playing") ?? navigator.mediaSession?.playbackState === "playing";
    return { title, artist, artworkUrl: artwork(), url: trackUrl(), duration, position, paused: !playing };
}

let last: (PlayerState & { at: number }) | null = null;

function changed(next: PlayerState | null, at: number) {
    if (!last || !next) return last !== next;
    if (next.title !== last.title || next.artist !== last.artist || next.url !== last.url || next.paused !== last.paused || next.artworkUrl !== last.artworkUrl) return true;
    if (at - last.at > HEARTBEAT_MS) return true;
    const expected = (last.position ?? 0) + (last.paused ? 0 : at - last.at);
    return Math.abs((next.position ?? 0) - expected) > DRIFT_MS;
}

setInterval(() => {
    const at = Date.now();
    const state = read();
    if (!changed(state, at)) return;
    last = state ? { ...state, at } : null;
    ipcRenderer.send("soundcloud:state", state);
}, POLL_MS);
