import { ipcMain, type WebContents } from "electron";
import { createMediaSessionReader } from "./media-session";
import { trackChanged } from "./music-tracks";
import type { MusicSource, MusicTrack, MusicWatch } from "./music-types";

const SOURCES: MusicSource[] = ["spotify"];

interface MusicOptions {
    allowed(url: string | undefined): boolean;
}

export function registerMusic({ allowed }: MusicOptions) {
    const watchers = new Map<WebContents, MusicWatch>();
    const sent = new Map<WebContents, Partial<Record<MusicSource, MusicTrack>>>();
    const hooked = new WeakSet<WebContents>();
    const reader = createMediaSessionReader();
    let readerRunning = false;
    let systemTracks: MusicTrack[] = [];

    const wants = (source: MusicSource) => [...watchers.values()].some((watch) => watch[source]);

    const current = (): Partial<Record<MusicSource, MusicTrack>> => ({
        spotify: systemTracks.find((track) => track.source === "spotify"),
    });

    const publish = (force = false) => {
        const tracks = current();
        for (const [contents, watch] of watchers) {
            if (contents.isDestroyed()) {
                forget(contents);
                continue;
            }
            const previous = sent.get(contents) ?? {};
            const next = Object.fromEntries(SOURCES.filter((source) => watch[source] && tracks[source]).map((source) => [source, tracks[source]]));
            if (!force && !SOURCES.some((source) => trackChanged(previous[source], next[source]))) continue;
            sent.set(contents, next);
            contents.send("music:tracks", Object.values(next));
        }
    };

    const updateReader = () => {
        if (!reader) return;
        const needed = wants("spotify");
        if (needed && !readerRunning) {
            readerRunning = true;
            reader.start((tracks) => {
                systemTracks = tracks;
                publish();
            });
        } else if (!needed && readerRunning) {
            readerRunning = false;
            reader.stop();
            systemTracks = [];
        }
    };

    const forget = (contents: WebContents) => {
        watchers.delete(contents);
        sent.delete(contents);
        updateReader();
    };

    ipcMain.on("music:watch", (event, input: unknown) => {
        if (!allowed(event.senderFrame?.url)) return;
        const contents = event.sender;
        const request = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
        const watch: MusicWatch = { spotify: request.spotify === true };
        if (!watch.spotify) {
            forget(contents);
            return;
        }
        if (!hooked.has(contents)) {
            hooked.add(contents);
            contents.once("destroyed", () => forget(contents));
            contents.on("did-start-navigation", (details) => {
                if (details.isMainFrame && !details.isSameDocument) forget(contents);
            });
        }
        watchers.set(contents, watch);
        sent.delete(contents);
        updateReader();
        publish(true);
    });

    return {
        stop() {
            reader?.stop();
            readerRunning = false;
        },
    };
}
