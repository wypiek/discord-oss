import assert from "node:assert/strict";
import { test } from "node:test";
import { UserActivityStats } from "@spacebar/database";
import { gameCredits } from "../../gateway/util/GameTimeSampler";
import { streamCredits } from "../../webrtc/util/StreamTimeSampler";
import {
    ACTIVITY_BADGE_TIERS,
    activityProgress,
    applyCredit,
    GAME_TIME_BADGE,
    GAME_VARIETY_BADGE,
    gameKey,
    MAX_TRACKED_GAMES,
    mergeCredits,
    nitroTierArt,
    STREAMING_BADGE,
} from "./ActivityBadges";

const AT = new Date("2026-11-11T18:00:00.000Z");
const emptyStats = () => Object.assign(new UserActivityStats(), { user_id: "1", game_seconds: "0", stream_seconds: "0", games: [], tier_unlocks: {} });

test("every activity badge has 10 tiers with rising thresholds", () => {
    for (const id of [STREAMING_BADGE, GAME_TIME_BADGE, GAME_VARIETY_BADGE] as const) {
        const tiers = ACTIVITY_BADGE_TIERS[id];
        assert.equal(tiers.length, 10);
        assert.ok(tiers.every((tier, i) => i === 0 || tier.threshold > tiers[i - 1].threshold));
        assert.equal(new Set(tiers.map((tier) => tier.key)).size, 10);
    }
});

test("only games count, keyed by application id or name", () => {
    assert.equal(gameKey({ type: 0, name: "Minecraft", application_id: "356875570916753438" }), "356875570916753438");
    assert.equal(gameKey({ type: 0, name: "  Celeste " }), "name:celeste");
    assert.equal(gameKey({ type: 2, name: "Spotify" }), null);
    assert.equal(gameKey({ type: 4, name: "Custom Status" }), null);
    assert.equal(gameKey({ type: 0, name: "   " }), null);
});

test("several sessions of one user in a sample count once", () => {
    const merged = mergeCredits([
        { user_id: "1", game_seconds: 60, games: ["a"] },
        { user_id: "1", game_seconds: 60, games: ["b"] },
        { user_id: "2", stream_seconds: 60 },
    ]);
    assert.deepEqual(merged, [
        { user_id: "1", game_seconds: 60, stream_seconds: 0, games: ["a", "b"] },
        { user_id: "2", game_seconds: 0, stream_seconds: 60, games: [] },
    ]);
});

test("credits add up and record the time each tier is first reached", () => {
    const stats = emptyStats();
    applyCredit(stats, { user_id: "1", game_seconds: 3600, stream_seconds: 5 * 3600, games: ["a", "b"] }, AT);
    assert.equal(stats.game_seconds, "3600");
    assert.deepEqual(activityProgress(stats), { [STREAMING_BADGE]: 5, [GAME_TIME_BADGE]: 1, [GAME_VARIETY_BADGE]: 2 });
    assert.deepEqual(stats.tier_unlocks[GAME_TIME_BADGE], { casual: AT.toISOString() });
    assert.deepEqual(Object.keys(stats.tier_unlocks[STREAMING_BADGE]), ["newcomer", "fledgling"]);
    assert.deepEqual(stats.tier_unlocks[GAME_VARIETY_BADGE], { sampler: AT.toISOString() });
    const later = new Date(AT.getTime() + 60_000);
    applyCredit(stats, { user_id: "1", game_seconds: 60, stream_seconds: 0, games: ["a"] }, later);
    assert.equal(stats.tier_unlocks[GAME_TIME_BADGE].casual, AT.toISOString());
    assert.deepEqual(stats.games, ["a", "b"]);
});

test("the list of games stops growing at the cap", () => {
    const stats = emptyStats();
    applyCredit(stats, { user_id: "1", game_seconds: 0, stream_seconds: 0, games: Array.from({ length: MAX_TRACKED_GAMES + 50 }, (_, i) => `g${i}`) }, AT);
    assert.equal(stats.games.length, MAX_TRACKED_GAMES);
});

test("the game sampler credits open sockets that are playing", () => {
    const credits = gameCredits(
        [
            { readyState: 1, user_id: "1", session: { activities: [{ type: 0, name: "Celeste" }] as never } },
            { readyState: 1, user_id: "2", session: { activities: [{ type: 2, name: "Spotify" }] as never } },
            { readyState: 3, user_id: "3", session: { activities: [{ type: 0, name: "Celeste" }] as never } },
            { readyState: 1, session: { activities: [{ type: 0, name: "Celeste" }] as never } },
        ],
        60,
    );
    assert.deepEqual(credits, [{ user_id: "1", game_seconds: 60, games: ["name:celeste"] }]);
});

test("streaming only counts while the owner streams to someone else", () => {
    const owners = new Map([
        ["s1", "owner1"],
        ["s2", "owner2"],
        ["s3", "owner3"],
    ]);
    const credits = streamCredits(
        [
            { type: "stream", readyState: 1, server_id: "s1", user_id: "owner1" },
            { type: "stream", readyState: 1, server_id: "s1", user_id: "viewer" },
            { type: "stream", readyState: 1, server_id: "s2", user_id: "owner2" },
            { type: "stream", readyState: 1, server_id: "s3", user_id: "viewer" },
            { type: "guild-voice", readyState: 1, server_id: "s2", user_id: "viewer" },
        ],
        owners,
        60,
    );
    assert.deepEqual(credits, [{ user_id: "owner1", stream_seconds: 60 }]);
});

test("the classic Nitro tenure icon names point at the current Nitro badge art", () => {
    assert.equal(nitroTierArt("premium_tenure_6_month_v2"), "6ecb8ab48a8abb284c3392dd956f8809fefca5f78c00e672454c16292051d576.png");
    assert.ok(nitroTierArt("2ba85e8026a8614b640c2837bcdfe21b")?.endsWith(".png"));
    assert.equal(nitroTierArt("5e74e9b61934fc1f67c65515d1f7e60d"), null);
    assert.equal(nitroTierArt("account_age_nine_years"), "d30993594816cc6035041941291dc7a5862e55676ce85eef91f89fd0c59f2931.png");
    assert.ok(nitroTierArt("game_variety_sampler")?.endsWith(".png"));
    assert.equal(nitroTierArt("account_age_eleven_years"), null);
});
