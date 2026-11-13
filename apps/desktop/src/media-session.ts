import { type ChildProcess, execFile, spawn } from "node:child_process";
import type { MusicSource, MusicTrack } from "./music-types";

export interface MediaSessionReader {
    start(onTracks: (tracks: MusicTrack[]) => void): void;
    stop(): void;
}

const POLL_MS = 5000;
const FIELD = "\u001f";

const run = (file: string, args: string[], timeout = 4000) =>
    new Promise<string | null>((resolve) => {
        execFile(file, args, { timeout, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) return resolve(stderr.includes("-1743") ? "denied" : null);
            resolve(stdout);
        });
    });

const finite = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined);

export function spotifyWebUrl(uri: string | undefined) {
    const match = uri ? /^spotify:(track|episode):([A-Za-z0-9]+)$/.exec(uri) : null;
    return match ? `https://open.spotify.com/${match[1]}/${match[2]}` : undefined;
}

const SPOTIFY_APPLESCRIPT = `tell application id "com.spotify.client"
    set playerState to player state as string
    if playerState is "stopped" then return "stopped"
    set t to current track
    set d to character id 31
    return playerState & d & (name of t) & d & (artist of t) & d & (album of t) & d & ((duration of t) as string) & d & ((player position) as string) & d & (spotify url of t) & d & (artwork url of t)
end tell`;

export function parseSpotifyAppleScript(output: string, now = Date.now()): MusicTrack | null {
    const [state, title, artist, album, duration, position, uri, artwork] = output.trim().split(FIELD);
    if (state !== "playing" && state !== "paused") return null;
    if (!title) return null;
    return {
        source: "spotify",
        title,
        artist: artist ?? "",
        album: album || undefined,
        artworkUrl: artwork?.startsWith("https://") ? artwork : undefined,
        url: spotifyWebUrl(uri),
        duration: finite(Number(duration)),
        position: finite(Math.round(Number((position ?? "").replace(",", ".")) * 1000)),
        paused: state !== "playing",
        updatedAt: now,
    };
}

class MacSpotifyReader implements MediaSessionReader {
    private timer: NodeJS.Timeout | null = null;
    private denied = false;

    start(onTracks: (tracks: MusicTrack[]) => void) {
        if (this.timer) return;
        const tick = async () => {
            if (this.denied) return onTracks([]);
            if ((await run("pgrep", ["-x", "Spotify"], 2000)) === null) return onTracks([]);
            const output = await run("osascript", ["-e", SPOTIFY_APPLESCRIPT]);
            if (output === "denied") this.denied = true;
            const track = output && output !== "denied" ? parseSpotifyAppleScript(output) : null;
            onTracks(track ? [track] : []);
        };
        this.timer = setInterval(tick, POLL_MS);
        void tick();
    }

    stop() {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }
}

type DBusValue = { type: string; data: unknown };

const dbusString = (value: DBusValue | undefined) => (typeof value?.data === "string" ? value.data : undefined);
const dbusNumber = (value: DBusValue | undefined) => finite(typeof value?.data === "number" ? value.data : Number(value?.data));
const dbusStrings = (value: DBusValue | undefined) => (Array.isArray(value?.data) ? value.data.filter((x): x is string => typeof x === "string") : []);

export function mprisSource(busName: string, url: string | undefined): MusicSource | null {
    if (/^org\.mpris\.MediaPlayer2\.spotify(\.|$)/i.test(busName)) return "spotify";
    if (url && /^https:\/\/(?:[a-z0-9-]+\.)*soundcloud\.com\//i.test(url)) return "soundcloud";
    return null;
}

export function parseMprisPlayer(busName: string, output: string, now = Date.now()): MusicTrack | null {
    const lines = output
        .split("\n")
        .filter(Boolean)
        .map((line) => {
            try {
                return JSON.parse(line) as DBusValue;
            } catch {
                return null;
            }
        });
    const [metadataValue, statusValue, positionValue] = lines;
    const metadata = (metadataValue?.data ?? {}) as Record<string, DBusValue>;
    const status = dbusString(statusValue ?? undefined);
    if (status !== "Playing" && status !== "Paused") return null;
    const title = dbusString(metadata["xesam:title"]);
    if (!title) return null;
    const url = dbusString(metadata["xesam:url"]);
    const source = mprisSource(busName, url);
    if (!source) return null;
    const art = dbusString(metadata["mpris:artUrl"]);
    const length = dbusNumber(metadata["mpris:length"]);
    const position = dbusNumber(positionValue ?? undefined);
    return {
        source,
        title,
        artist: dbusStrings(metadata["xesam:artist"]).join(", "),
        album: dbusString(metadata["xesam:album"]) || undefined,
        artworkUrl: art?.startsWith("https://") ? art : undefined,
        url: url?.startsWith("https://") ? url : undefined,
        duration: length !== undefined ? Math.round(length / 1000) : undefined,
        position: position !== undefined && position > 0 ? Math.round(position / 1000) : undefined,
        paused: status !== "Playing",
        updatedAt: now,
    };
}

class LinuxMprisReader implements MediaSessionReader {
    private timer: NodeJS.Timeout | null = null;

    start(onTracks: (tracks: MusicTrack[]) => void) {
        if (this.timer) return;
        const tick = async () => {
            const names = await run("busctl", ["--user", "--json=short", "call", "org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "ListNames"], 2000);
            let players: string[] = [];
            try {
                players = ((JSON.parse(names ?? "{}") as DBusValue).data as string[][])[0].filter((name) => name.startsWith("org.mpris.MediaPlayer2."));
            } catch {}
            const tracks = await Promise.all(
                players.slice(0, 8).map(async (name) => {
                    const output = await run(
                        "busctl",
                        ["--user", "--json=short", "get-property", name, "/org/mpris/MediaPlayer2", "org.mpris.MediaPlayer2.Player", "Metadata", "PlaybackStatus", "Position"],
                        2000,
                    );
                    return output ? parseMprisPlayer(name, output) : null;
                }),
            );
            onTracks(tracks.filter((track): track is MusicTrack => !!track));
        };
        this.timer = setInterval(tick, POLL_MS);
        void tick();
    }

    stop() {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }
}

const SMTC_SCRIPT = `$ErrorActionPreference = "SilentlyContinue"
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq "IAsyncOperation\`1" })[0]
function Await($operation, [Type]$type) { $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation)); $task.Wait(-1) | Out-Null; $task.Result }
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
$manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
while ($true) {
    if (-not (Get-Process -Id PARENT_PID -ErrorAction SilentlyContinue)) { exit }
    $items = @()
    foreach ($session in $manager.GetSessions()) {
        $app = [string]$session.SourceAppUserModelId
        if ($app -notmatch "spotify") { continue }
        $media = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
        $timeline = $session.GetTimelineProperties()
        $items += [pscustomobject]@{ app = $app; title = [string]$media.Title; artist = [string]$media.Artist; album = [string]$media.AlbumTitle; position = [int64]$timeline.Position.TotalMilliseconds; duration = [int64]$timeline.EndTime.TotalMilliseconds; updated = [int64]$timeline.LastUpdatedTime.ToUnixTimeMilliseconds(); status = [string]$session.GetPlaybackInfo().PlaybackStatus }
    }
    [Console]::Out.WriteLine((ConvertTo-Json -Compress -Depth 3 -InputObject @($items)))
    [Console]::Out.Flush()
    Start-Sleep -Seconds 3
}`;

interface SmtcSession {
    app?: string;
    title?: string;
    artist?: string;
    album?: string;
    position?: number;
    duration?: number;
    updated?: number;
    status?: string;
}

export function parseSmtcLine(line: string, now = Date.now()): MusicTrack[] {
    let sessions: SmtcSession[];
    try {
        const parsed = JSON.parse(line) as SmtcSession | SmtcSession[];
        sessions = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
        return [];
    }
    return sessions
        .filter((session) => /spotify/i.test(session.app ?? "") && !!session.title && (session.status === "Playing" || session.status === "Paused"))
        .slice(0, 1)
        .map((session) => {
            const updated = finite(session.updated) && session.updated! > 0 && session.updated! <= now ? session.updated! : now;
            return {
                source: "spotify" as const,
                title: session.title!,
                artist: session.artist ?? "",
                album: session.album || undefined,
                duration: finite(session.duration) || undefined,
                position: finite(session.position),
                paused: session.status !== "Playing",
                updatedAt: updated,
            };
        });
}

class WindowsSmtcReader implements MediaSessionReader {
    private child: ChildProcess | null = null;
    private stopped = true;

    start(onTracks: (tracks: MusicTrack[]) => void) {
        if (this.child) return;
        this.stopped = false;
        const script = SMTC_SCRIPT.replace("PARENT_PID", String(process.pid));
        const child = spawn(
            "powershell.exe",
            ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
            {
                windowsHide: true,
                stdio: ["ignore", "pipe", "ignore"],
            },
        );
        this.child = child;
        let buffer = "";
        child.stdout?.setEncoding("utf8");
        child.stdout?.on("data", (chunk: string) => {
            buffer += chunk;
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() ?? "";
            const last = lines.filter(Boolean).at(-1);
            if (last) onTracks(parseSmtcLine(last));
        });
        child.on("error", () => onTracks([]));
        child.on("exit", () => {
            this.child = null;
            onTracks([]);
            if (!this.stopped) setTimeout(() => !this.stopped && this.start(onTracks), 30_000).unref();
        });
    }

    stop() {
        this.stopped = true;
        this.child?.kill();
        this.child = null;
    }
}

export function createMediaSessionReader(): MediaSessionReader | null {
    if (process.platform === "darwin") return new MacSpotifyReader();
    if (process.platform === "win32") return new WindowsSmtcReader();
    if (process.platform === "linux") return new LinuxMprisReader();
    return null;
}
