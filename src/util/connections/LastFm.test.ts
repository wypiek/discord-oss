import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import { durationFromTrackInfo, lastFmNowPlaying, lastFmSignature, nowPlayingFromRecentTracks, resetLastFmCache } from "./LastFm";

const playing = (name: string, artist = "Artist") => ({
    recenttracks: {
        track: [
            {
                name,
                artist: { "#text": artist },
                album: { "#text": "Album" },
                url: `https://www.last.fm/music/${artist}/_/${name}`,
                image: [
                    { size: "small", "#text": "https://lastfm.freetls.fastly.net/i/u/34s/abc.jpg" },
                    { size: "extralarge", "#text": "https://lastfm.freetls.fastly.net/i/u/300x300/abc.jpg" },
                ],
                "@attr": { nowplaying: "true" },
            },
        ],
    },
});

test("the session signature sorts parameters, skips format and appends the secret", () => {
    const expected = crypto.createHash("md5").update("api_keykeymethodauth.getSessiontokentoksecret").digest("hex");
    assert.equal(lastFmSignature({ token: "tok", method: "auth.getSession", api_key: "key", format: "json" }, "secret"), expected);
});

test("only a track marked now playing counts, with the largest real artwork", () => {
    const track = nowPlayingFromRecentTracks(playing("Song"));
    assert.deepEqual(track, {
        title: "Song",
        artist: "Artist",
        album: "Album",
        url: "https://www.last.fm/music/Artist/_/Song",
        artwork_url: "https://lastfm.freetls.fastly.net/i/u/300x300/abc.jpg",
    });
    const scrobbled = playing("Song");
    delete (scrobbled.recenttracks.track[0] as Record<string, unknown>)["@attr"];
    assert.equal(nowPlayingFromRecentTracks(scrobbled), null);
    assert.equal(nowPlayingFromRecentTracks({ error: 6, message: "User not found" }), null);
});

test("placeholder artwork and links to other hosts are dropped", () => {
    const body = playing("Song");
    const track = body.recenttracks.track[0] as Record<string, unknown>;
    track.image = [{ size: "extralarge", "#text": "https://lastfm.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png" }];
    track.url = "https://evil.example/music";
    const parsed = nowPlayingFromRecentTracks(body);
    assert.equal(parsed?.artwork_url, undefined);
    assert.equal(parsed?.url, undefined);
});

test("track durations are read in milliseconds and zero means unknown", () => {
    assert.equal(durationFromTrackInfo({ track: { duration: "215000" } }), 215000);
    assert.equal(durationFromTrackInfo({ track: { duration: "0" } }), undefined);
    assert.equal(durationFromTrackInfo({}), undefined);
});

test("lookups are cached for ten seconds and the start time stays while the track does", async () => {
    resetLastFmCache();
    let time = 1_000_000;
    let song = "One";
    const calls: string[] = [];
    const fetchJson = async (url: string) => {
        const method = new URL(url).searchParams.get("method") as string;
        calls.push(method);
        return method === "track.getInfo" ? { track: { duration: "200000" } } : playing(song);
    };
    const first = await lastFmNowPlaying("Someone", "key", fetchJson, () => time);
    assert.equal(first?.since, 1_000_000);
    assert.equal(first?.duration_ms, 200000);
    time += 5000;
    await lastFmNowPlaying("someone", "key", fetchJson, () => time);
    assert.deepEqual(calls, ["user.getRecentTracks", "track.getInfo"]);
    time += 10_000;
    const same = await lastFmNowPlaying("Someone", "key", fetchJson, () => time);
    assert.equal(same?.since, 1_000_000);
    assert.deepEqual(calls, ["user.getRecentTracks", "track.getInfo", "user.getRecentTracks"]);
    song = "Two";
    time += 10_000;
    const next = await lastFmNowPlaying("Someone", "key", fetchJson, () => time);
    assert.equal(next?.title, "Two");
    assert.equal(next?.since, time);
});

test("a failed lookup answers nothing playing", async () => {
    resetLastFmCache();
    const result = await lastFmNowPlaying("Someone", "key", async () => {
        throw new Error("network");
    });
    assert.equal(result, null);
});
