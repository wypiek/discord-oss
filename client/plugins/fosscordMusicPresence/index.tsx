import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import definePlugin, { OptionType } from "@utils/types";
import type { Activity } from "@vencord/discord-types";
import { ApplicationAssetUtils, ConnectedAccountsStore, FluxDispatcher, SpotifyStore } from "@webpack/common";

import { FosscordAuthor } from "../fosscordCore/shared";

type MusicSource = "spotify" | "soundcloud";

interface MusicTrack {
    source: MusicSource;
    title: string;
    artist: string;
    album?: string;
    artworkUrl?: string;
    url?: string;
    duration?: number;
    position?: number;
    paused: boolean;
    updatedAt: number;
}

interface MusicBridge {
    watch(sources: Partial<Record<MusicSource, boolean>>): void;
    onTracks(listener: (tracks: MusicTrack[]) => void): () => void;
    openSoundCloud(): void;
}

interface SpotifyAccount {
    id: string;
    type: string;
    revoked?: boolean;
    accessToken?: string;
}

type PlayerStateFetcher = (accountId: string, accessToken: string) => Promise<unknown>;

const SOCKET_ID = "FosscordMusicPresence";
const SPOTIFY_POLL_MS = 15_000;
const START_TOLERANCE_MS = 3000;
const LISTENING = 2;

const SERVICES: Record<MusicSource, { name: string; applicationId: string; button: string }> = {
    soundcloud: { name: "SoundCloud", applicationId: "1440106212185735168", button: "Listen on SoundCloud" },
    spotify: { name: "Spotify", applicationId: "1440106212185735169", button: "Play on Spotify" },
};

const tokens = new Map<string, string>();
const assetCache = new Map<string, string>();
let fetchPlayerState: PlayerStateFetcher | null = null;
let tracks: MusicTrack[] = [];
let unsubscribe: (() => void) | null = null;
let spotifyTimer: ReturnType<typeof setInterval> | null = null;
let lastActivity = "";
let lastStart: { key: string; start: number } | null = null;
let renderId = 0;

const bridge = (): MusicBridge | undefined => (window as unknown as { DiscordOSS?: { music?: MusicBridge } }).DiscordOSS?.music;

function rewatch(): void {
    bridge()?.watch({ soundcloud: settings.store.soundcloud, spotify: settings.store.spotify });
}

const settings = definePluginSettings({
    soundcloud: {
        type: OptionType.BOOLEAN,
        description: "Show what plays in the desktop app's SoundCloud window as your activity",
        default: true,
        onChange: rewatch,
    },
    spotify: {
        type: OptionType.BOOLEAN,
        description: "Show what plays in the Spotify app as your activity, read by the desktop app, when no Spotify account is connected",
        default: true,
        onChange: rewatch,
    },
    refreshSpotify: {
        type: OptionType.BOOLEAN,
        description: "Check a connected Spotify account's player every 15 seconds, so its activity follows track changes",
        default: true,
    },
});

const clamp = (text: string | undefined, max: number) => (text && text.length > max ? `${text.slice(0, max - 3)}...` : text);

const spotifyImageKey = (url: string | undefined) => {
    const id = url ? /^https:\/\/i\.scdn\.co\/image\/([A-Za-z0-9]+)$/.exec(url)?.[1] : undefined;
    return id ? `spotify:${id}` : undefined;
};

const spotifyAccounts = () => ((ConnectedAccountsStore.getAccounts() ?? []) as unknown as SpotifyAccount[]).filter((account) => account.type === "spotify" && !account.revoked);

function refreshSpotify(): void {
    if (!settings.store.refreshSpotify || !fetchPlayerState) return;
    for (const account of spotifyAccounts()) {
        const token = tokens.get(account.id) ?? account.accessToken;
        if (token) fetchPlayerState(account.id, token).catch(() => {});
    }
}

function pickTrack(): MusicTrack | null {
    const playing = tracks.filter((track) => !track.paused && track.title);
    const soundcloud = settings.store.soundcloud ? playing.find((track) => track.source === "soundcloud") : undefined;
    if (soundcloud) return soundcloud;
    if (!settings.store.spotify || spotifyAccounts().length || SpotifyStore.getActivity()) return null;
    return playing.find((track) => track.source === "spotify") ?? null;
}

function startTime(track: MusicTrack): number {
    const key = `${track.source}:${track.url ?? `${track.title}:${track.artist}`}`;
    const start = track.updatedAt - (track.position ?? 0);
    const stable = lastStart?.key === key && Math.abs(lastStart.start - start) <= START_TOLERANCE_MS ? lastStart.start : start;
    lastStart = { key, start: stable };
    return stable;
}

async function largeImage(track: MusicTrack, applicationId: string): Promise<string | undefined> {
    if (!track.artworkUrl) return undefined;
    const spotifyKey = spotifyImageKey(track.artworkUrl);
    if (spotifyKey) return spotifyKey;
    const cached = assetCache.get(track.artworkUrl);
    if (cached) return cached;
    const [asset] = await ApplicationAssetUtils.fetchAssetIds(applicationId, [track.artworkUrl]).catch(() => [] as string[]);
    if (asset) assetCache.set(track.artworkUrl, asset);
    return asset || undefined;
}

function setActivity(activity: Activity | null): void {
    const serialized = JSON.stringify(activity);
    if (serialized === lastActivity) return;
    lastActivity = serialized;
    FluxDispatcher.dispatch({ type: "LOCAL_ACTIVITY_UPDATE", activity, socketId: SOCKET_ID });
}

async function render(): Promise<void> {
    const id = ++renderId;
    const track = pickTrack();
    if (!track) return setActivity(null);
    const service = SERVICES[track.source];
    const start = startTime(track);
    const image = await largeImage(track, service.applicationId);
    if (id !== renderId) return;
    setActivity({
        application_id: service.applicationId,
        name: service.name,
        type: LISTENING,
        details: clamp(track.title, 128),
        ...(track.url && { details_url: track.url }),
        state: clamp(track.artist, 128) || undefined,
        timestamps: track.duration ? { start, end: start + track.duration } : { start },
        assets: image ? { large_image: image, large_text: clamp(track.album, 128) } : undefined,
        buttons: track.url ? [service.button] : undefined,
        metadata: track.url ? { button_urls: [track.url] } : undefined,
        flags: 0,
    } as unknown as Activity);
}

export default definePlugin({
    name: "FosscordMusicPresence",
    description: "Shows what you listen to on SoundCloud or Spotify as a Listening activity, read from the desktop app, and keeps a connected Spotify account's activity current.",
    authors: [FosscordAuthor],
    required: true,
    settings,

    patches: [
        {
            find: '"hm://pusher/v1/connections/"',
            replacement: {
                match: /function (\i)\((\i),(\i)\)\{return \i\.\i\.get\(\2,\3,\{url:\i\.\i\.PLAYER,/,
                replace: "$self.setPlayerStateFetcher($1);$&",
            },
        },
    ],

    setPlayerStateFetcher(fetcher: PlayerStateFetcher) {
        fetchPlayerState = fetcher;
    },

    flux: {
        SPOTIFY_ACCOUNT_ACCESS_TOKEN({ accountId, accessToken }: { accountId: string; accessToken: string }) {
            tokens.set(accountId, accessToken);
        },
        SPOTIFY_ACCOUNT_ACCESS_TOKEN_REVOKE({ accountId }: { accountId: string }) {
            tokens.delete(accountId);
        },
        USER_CONNECTIONS_UPDATE() {
            void render();
        },
    },

    settingsAboutComponent() {
        const music = bridge();
        if (!music) return <p>The SoundCloud window and the Spotify app need the desktop app. A Spotify account connected under Connections works everywhere.</p>;
        return (
            <Button size="small" onClick={() => music.openSoundCloud()}>
                Open SoundCloud
            </Button>
        );
    },

    start() {
        const music = bridge();
        if (music) {
            unsubscribe = music.onTracks((next) => {
                tracks = Array.isArray(next) ? next : [];
                void render();
            });
            rewatch();
        }
        spotifyTimer = setInterval(refreshSpotify, SPOTIFY_POLL_MS);
    },

    stop() {
        bridge()?.watch({});
        unsubscribe?.();
        unsubscribe = null;
        if (spotifyTimer) clearInterval(spotifyTimer);
        spotifyTimer = null;
        tracks = [];
        setActivity(null);
    },
});
