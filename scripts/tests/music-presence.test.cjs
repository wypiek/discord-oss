const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.join(__dirname, "..", "..");

function load(file, imports, globals = {}) {
    const module = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText,
        {
            module,
            exports: module.exports,
            require: (name) => {
                if (!(name in imports)) throw new Error(`unexpected import ${name}`);
                return imports[name];
            },
            Buffer,
            URLSearchParams,
            AbortSignal,
            Date,
            Promise,
            Map,
            ...globals,
        },
    );
    return module.exports;
}

const revoked = new Error("The connection has been revoked");
const generalError = new Error("General error");

function connections({ fetch, updates = [], errors = [] }) {
    const ConnectedAccount = { update: async (where, values) => updates.push({ where, values }) };
    class Connection {}
    const refreshable = load("src/util/connections/RefreshableConnection.ts", {
        "../../database/entities": { ConnectedAccount },
        "./Connection": { Connection },
        "@spacebar/schemas": {},
    });
    const spotify = load(
        "src/connections/Spotify/index.ts",
        {
            wretch: () => {
                throw new Error("unused");
            },
            "@spacebar/database": { ConnectedAccount },
            "@spacebar/util": {
                ConnectionLoader: { getConnectionConfig: (_id, settings) => settings },
                DiscordApiErrors: { CONNECTION_REVOKED: revoked, GENERAL_ERROR: generalError },
                RefreshableConnection: refreshable.RefreshableConnection,
            },
            "@spacebar/schemas": {},
            "../GenericOAuthSettings": {
                GenericOAuthSettings: class {
                    enabled = true;
                    clientId = "client";
                    clientSecret = "secret";
                },
            },
        },
        { fetch, console: { error: (...args) => errors.push(args.join(" ")), log() {} } },
    );
    return { refreshable, Spotify: spotify.default, updates, errors };
}

const account = (token_data) => ({ user_id: "1", external_id: "spotify-user", type: "spotify", token_data });

test("token expiry uses expires_in from fetched_at with a one minute margin", () => {
    const { refreshable } = connections({ fetch: async () => null });
    const now = 1_000_000_000;
    assert.equal(refreshable.isTokenExpired(null, now), true);
    assert.equal(refreshable.isTokenExpired({ access_token: "a", fetched_at: now - 1000, expires_in: 3600 }, now), false);
    assert.equal(refreshable.isTokenExpired({ access_token: "a", fetched_at: now - 3_550_000, expires_in: 3600 }, now), true);
    assert.equal(refreshable.isTokenExpired({ access_token: "a", fetched_at: now }, now), false);
    assert.equal(refreshable.isTokenExpired({ access_token: "a", fetched_at: now, expires_at: now + 30_000 }, now), true);
});

test("a Spotify refresh keeps the refresh token Spotify leaves out and runs once for parallel callers", async () => {
    let calls = 0;
    const fetch = async (url, init) => {
        calls++;
        assert.equal(url, "https://accounts.spotify.com/api/token");
        assert.equal(init.body.get("grant_type"), "refresh_token");
        assert.equal(init.body.get("refresh_token"), "refresh-1");
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { ok: true, status: 200, json: async () => ({ access_token: "access-2", token_type: "Bearer", scope: "user-read-playback-state", expires_in: 3600 }) };
    };
    const { Spotify, updates } = connections({ fetch });
    const spotify = new Spotify();
    spotify.init();
    const connected = account({ access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600, fetched_at: 0 });
    const [first, second] = await Promise.all([spotify.refresh(connected), spotify.refresh(connected)]);
    assert.equal(calls, 1);
    assert.equal(first, second);
    assert.equal(first.access_token, "access-2");
    assert.equal(first.refresh_token, "refresh-1");
    assert.equal(updates.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(updates[0].where)), { user_id: "1", external_id: "spotify-user", type: "spotify" });
    assert.equal(updates[0].values.token_data.refresh_token, "refresh-1");
});

test("a revoked Spotify refresh token marks the connection revoked without logging tokens", async () => {
    const fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: "invalid_grant", error_description: "Refresh token revoked" }) });
    const { Spotify, updates, errors } = connections({ fetch });
    const spotify = new Spotify();
    spotify.init();
    await assert.rejects(spotify.refresh(account({ access_token: "secret-access", refresh_token: "secret-refresh", fetched_at: 0 })), revoked);
    assert.deepEqual(JSON.parse(JSON.stringify(updates[0].values)), { revoked: true, token_data: null });
    assert.equal(errors.length, 0);
});

test("other Spotify refresh failures log only the status", async () => {
    const fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: "invalid_client" }) });
    const { Spotify, updates, errors } = connections({ fetch });
    const spotify = new Spotify();
    spotify.init();
    await assert.rejects(spotify.refresh(account({ access_token: "secret-access", refresh_token: "secret-refresh", fetched_at: 0 })), generalError);
    assert.equal(updates.length, 0);
    assert.equal(errors.length, 1);
    assert.doesNotMatch(errors[0], /secret|Basic/);
    assert.match(errors[0], /400 \(invalid_client\)/);
});

test("Spotify asks for the scopes the client's player integration uses", () => {
    const { Spotify } = connections({ fetch: async () => null });
    const spotify = new Spotify();
    spotify.init();
    for (const scope of ["user-read-private", "user-read-playback-state", "user-read-currently-playing", "user-modify-playback-state"]) assert.ok(spotify.scopes.includes(scope));
});

test("the desktop app reads Spotify from AppleScript output", () => {
    const { parseSpotifyAppleScript, spotifyWebUrl } = require("../../apps/desktop/src/media-session.ts");
    const output = ["playing", "Song", "Artist", "Album", "215000", "12,5", "spotify:track:4uLU6hMCjMI75M1A2tKUQC", "https://i.scdn.co/image/ab67"].join("\u001f");
    assert.deepEqual(parseSpotifyAppleScript(`${output}\n`, 1000), {
        source: "spotify",
        title: "Song",
        artist: "Artist",
        album: "Album",
        artworkUrl: "https://i.scdn.co/image/ab67",
        url: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
        duration: 215000,
        position: 12500,
        paused: false,
        updatedAt: 1000,
    });
    assert.equal(parseSpotifyAppleScript("stopped\n"), null);
    assert.equal(spotifyWebUrl("spotify:local:a:b:c:1"), undefined);
});

test("the desktop app reads Spotify and SoundCloud players from MPRIS", () => {
    const { parseMprisPlayer } = require("../../apps/desktop/src/media-session.ts");
    const metadata = (fields) => JSON.stringify({ type: "a{sv}", data: fields });
    const spotify = [
        metadata({
            "xesam:title": { type: "s", data: "Song" },
            "xesam:artist": { type: "as", data: ["One", "Two"] },
            "xesam:album": { type: "s", data: "Album" },
            "xesam:url": { type: "s", data: "https://open.spotify.com/track/abc" },
            "mpris:artUrl": { type: "s", data: "https://i.scdn.co/image/abc" },
            "mpris:length": { type: "t", data: 180000000 },
        }),
        JSON.stringify({ type: "s", data: "Paused" }),
        JSON.stringify({ type: "x", data: 0 }),
    ].join("\n");
    const track = parseMprisPlayer("org.mpris.MediaPlayer2.spotify", spotify, 5);
    assert.equal(track.source, "spotify");
    assert.equal(track.artist, "One, Two");
    assert.equal(track.duration, 180000);
    assert.equal(track.position, undefined);
    assert.equal(track.paused, true);
    const browser = [
        metadata({ "xesam:title": { type: "s", data: "Mix" }, "xesam:url": { type: "s", data: "https://soundcloud.com/a/mix" } }),
        JSON.stringify({ type: "s", data: "Playing" }),
        JSON.stringify({ type: "x", data: 30000000 }),
    ].join("\n");
    assert.equal(parseMprisPlayer("org.mpris.MediaPlayer2.firefox.instance_1_2", browser, 5).source, "soundcloud");
    assert.equal(parseMprisPlayer("org.mpris.MediaPlayer2.firefox.instance_1_2", browser.replace("soundcloud.com", "youtube.com"), 5), null);
});

test("the desktop app reads Spotify from Windows media sessions", () => {
    const { parseSmtcLine } = require("../../apps/desktop/src/media-session.ts");
    const line = JSON.stringify([
        { app: "chrome.exe", title: "Video", status: "Playing" },
        { app: "Spotify.exe", title: "Song", artist: "Artist", album: "", position: 4000, duration: 200000, updated: 900, status: "Playing" },
    ]);
    assert.deepEqual(parseSmtcLine(line, 1000), [
        { source: "spotify", title: "Song", artist: "Artist", album: undefined, duration: 200000, position: 4000, paused: false, updatedAt: 900 },
    ]);
    assert.deepEqual(parseSmtcLine("[]", 1000), []);
    assert.deepEqual(parseSmtcLine("not json", 1000), []);
});

test("SoundCloud window state is cleaned before it reaches the web client", () => {
    const { soundCloudTrack, trackChanged } = require("../../apps/desktop/src/music-tracks.ts");
    const track = soundCloudTrack(
        {
            title: "  Mix  ",
            artist: "DJ",
            url: "https://soundcloud.com/dj/mix",
            artworkUrl: "https://i1.sndcdn.com/artworks-1-t500x500.jpg",
            duration: 300000,
            position: 1000,
            paused: false,
        },
        50,
    );
    assert.equal(track.title, "Mix");
    assert.equal(track.url, "https://soundcloud.com/dj/mix");
    assert.equal(track.artworkUrl, "https://i1.sndcdn.com/artworks-1-t500x500.jpg");
    const hostile = soundCloudTrack({ title: "x", url: "https://evil.example/dj", artworkUrl: "javascript:alert(1)", duration: -5, paused: "no" }, 50);
    assert.equal(hostile.url, undefined);
    assert.equal(hostile.artworkUrl, undefined);
    assert.equal(hostile.duration, undefined);
    assert.equal(hostile.paused, true);
    assert.equal(soundCloudTrack({ title: "" }), null);
    assert.equal(trackChanged(track, { ...track, updatedAt: 2050, position: 3000 }), false);
    assert.equal(trackChanged(track, { ...track, updatedAt: 2050, position: 60000 }), true);
    assert.equal(trackChanged(track, { ...track, paused: true }), true);
});
