import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import type { Activity } from "@vencord/discord-types";
import { ApplicationAssetUtils, ConnectedAccountsStore, FluxDispatcher, RestAPI, SpotifyStore } from "@webpack/common";

import { FosscordAuthor } from "../fosscordCore/shared";

type MusicSource = "spotify" | "lastfm";

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
    watch(sources: { spotify?: boolean }): void;
    onTracks(listener: (tracks: MusicTrack[]) => void): () => void;
}

interface LastFmTrack {
    title: string;
    artist: string;
    album?: string;
    url?: string;
    artwork_url?: string;
    duration_ms?: number;
    elapsed_ms: number;
}

interface ConnectedAccount {
    id: string;
    type: string;
    revoked?: boolean;
    accessToken?: string;
}

type PlayerStateFetcher = (accountId: string, accessToken: string) => Promise<unknown>;

const SOCKET_ID = "FosscordMusicPresence";
const SPOTIFY_POLL_MS = 15_000;
const LASTFM_POLL_MS = 15_000;
const START_TOLERANCE_MS = 3000;
const LISTENING = 2;

const SERVICES: Record<MusicSource, { name: string; applicationId: string; button: string }> = {
    lastfm: { name: "Last.fm", applicationId: "1440106212185735170", button: "View on Last.fm" },
    spotify: { name: "Spotify", applicationId: "1440106212185735169", button: "Play on Spotify" },
};

const tokens = new Map<string, string>();
const assetCache = new Map<string, string>();
let fetchPlayerState: PlayerStateFetcher | null = null;
let tracks: MusicTrack[] = [];
let unsubscribe: (() => void) | null = null;
let spotifyTimer: ReturnType<typeof setInterval> | null = null;
let lastFmTimer: ReturnType<typeof setInterval> | null = null;
let lastFmTrack: MusicTrack | null = null;
let lastFmPolling = false;
let lastActivity = "";
let lastStart: { key: string; start: number } | null = null;
let renderId = 0;

const bridge = (): MusicBridge | undefined => (window as unknown as { DiscordOSS?: { music?: MusicBridge } }).DiscordOSS?.music;

function rewatch(): void {
    bridge()?.watch({ spotify: settings.store.spotify });
}

const settings = definePluginSettings({
    lastfm: {
        type: OptionType.BOOLEAN,
        description: "Show what a connected Last.fm account is scrobbling as your activity, when Spotify isn't already shown",
        default: true,
        onChange: () => void pollLastFm(),
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

const accountsOf = (type: string) => ((ConnectedAccountsStore.getAccounts() ?? []) as unknown as ConnectedAccount[]).filter((account) => account.type === type && !account.revoked);
const spotifyAccounts = () => accountsOf("spotify");

function lastFmMusicTrack(track: LastFmTrack, now = Date.now()): MusicTrack {
    const duration = track.duration_ms && track.elapsed_ms <= track.duration_ms ? track.duration_ms : undefined;
    return {
        source: "lastfm",
        title: track.title,
        artist: track.artist,
        album: track.album,
        artworkUrl: track.artwork_url,
        url: track.url,
        duration,
        position: track.elapsed_ms,
        paused: false,
        updatedAt: now,
    };
}

async function pollLastFm(): Promise<void> {
    const [account] = settings.store.lastfm ? accountsOf("lastfm") : [];
    if (!account) {
        if (lastFmTrack) {
            lastFmTrack = null;
            void render();
        }
        return;
    }
    if (lastFmPolling) return;
    lastFmPolling = true;
    try {
        const { body } = await RestAPI.get({ url: `/users/@me/connections/lastfm/${encodeURIComponent(account.id)}/now-playing` });
        const track = (body as { track?: LastFmTrack | null })?.track;
        lastFmTrack = track?.title && track.artist ? lastFmMusicTrack(track) : null;
    } catch {
        lastFmTrack = null;
    } finally {
        lastFmPolling = false;
    }
    void render();
}

function refreshSpotify(): void {
    if (!settings.store.refreshSpotify || !fetchPlayerState) return;
    for (const account of spotifyAccounts()) {
        const token = tokens.get(account.id) ?? account.accessToken;
        if (token) fetchPlayerState(account.id, token).catch(() => {});
    }
}

function pickTrack(): MusicTrack | null {
    if (SpotifyStore.getActivity()) return null;
    const desktopSpotify = settings.store.spotify && !spotifyAccounts().length ? tracks.find((track) => track.source === "spotify" && !track.paused && track.title) : undefined;
    if (desktopSpotify) return desktopSpotify;
    return settings.store.lastfm ? lastFmTrack : null;
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
    description:
        "Shows what a connected Last.fm account is playing, or the Spotify app read by the desktop app, as a Listening activity, and keeps a connected Spotify account's activity current.",
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
            void pollLastFm();
        },
    },

    settingsAboutComponent() {
        return <p>Connect Last.fm or Spotify under Connections to share what you listen to anywhere. Reading the Spotify app without a connected account needs the desktop app.</p>;
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
        lastFmTimer = setInterval(() => void pollLastFm(), LASTFM_POLL_MS);
        void pollLastFm();
    },

    stop() {
        bridge()?.watch({});
        unsubscribe?.();
        unsubscribe = null;
        if (spotifyTimer) clearInterval(spotifyTimer);
        spotifyTimer = null;
        if (lastFmTimer) clearInterval(lastFmTimer);
        lastFmTimer = null;
        lastFmTrack = null;
        tracks = [];
        setActivity(null);
    },
});
