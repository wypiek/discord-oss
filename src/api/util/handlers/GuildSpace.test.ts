import assert from "node:assert/strict";
import { test } from "node:test";
import {
    canViewGuildSpace,
    DEFAULT_GUILD_SPACE_WIDGETS,
    GUILD_SPACE_CATALOG,
    guildSpaceCatalog,
    LeaderboardStat,
    leaderboardStat,
    orderedWidgets,
    popularGames,
    POPULAR_GAMES_SIZE,
    rankLeaderboard,
    serializeGuildSpace,
    widgetLimitErrors,
} from "./GuildSpace";
import { guildSpaceSettingsOf } from "@spacebar/schemas";
import { gamePlayRows } from "@spacebar/util";

const at = (iso: string) => new Date(iso);
const play = (user_id: string, day: string, game: string, seconds: number, last = `${day}T12:00:00.000Z`) => ({
    user_id,
    day,
    game,
    seconds,
    last_played_at: at(last),
    application_id: /^\d+$/.test(game) ? game : null,
});

test("a new hub is enabled, unpublished and only visible to managers", () => {
    const settings = guildSpaceSettingsOf(null);
    assert.deepEqual(settings, { enabled: true, publish_status: 0 });
    assert.equal(canViewGuildSpace(settings, true), true);
    assert.equal(canViewGuildSpace(settings, false), false);
    assert.equal(canViewGuildSpace({ enabled: true, publish_status: 1 }, false), true);
    assert.equal(canViewGuildSpace({ enabled: false, publish_status: 1 }, true), false);
});

test("a new hub shows the leaderboard and whiteboard on the left and popular games on the right", () => {
    const space = serializeGuildSpace({ id: "1", guild_space: null });
    assert.deepEqual(
        space.widgets.map((widget) => [widget.type, widget.position.column, widget.position.order]),
        [
            ["leaderboard", 0, 0],
            ["whiteboard", 0, 1],
            ["popular_games", 1, 0],
        ],
    );
    assert.equal(space.header.custom_banner_hash, null);
    assert.ok(space.widgets.every((widget) => widget.locked === false && widget.default_title));
    assert.equal(DEFAULT_GUILD_SPACE_WIDGETS.length, 3);
});

test("every catalog widget is free and unlocked", () => {
    for (const widget of guildSpaceCatalog().widgets) {
        assert.equal(widget.boost_price, 0);
        assert.equal(widget.locked, false);
        assert.equal(widget.powerup_sku_id, null);
        assert.match(widget.assets.catalog_image_static_url, /\/content-assets\/[0-9a-f]{64}\.svg$/);
    }
    assert.deepEqual(GUILD_SPACE_CATALOG.map((entry) => entry.type).sort(), ["image_text", "leaderboard", "popular_games", "whiteboard"]);
});

test("widget positions are packed per column in their requested order", () => {
    const widgets = orderedWidgets([
        { id: "a", type: "leaderboard", position: { column: 0, order: 5 }, config: { type: "leaderboard" } },
        { id: "b", type: "whiteboard", position: { column: 0, order: 1 }, config: { type: "whiteboard" } },
        { id: "c", type: "popular_games", position: { column: 1, order: 9 }, config: { type: "popular_games" } },
        { id: "d", type: "image_text", position: { column: 1, order: 9 }, config: { type: "image_text", text: "hi" } },
    ]);
    assert.deepEqual(
        widgets.map((widget) => [widget.id, widget.position.column, widget.position.order]),
        [
            ["b", 0, 0],
            ["a", 0, 1],
            ["c", 1, 0],
            ["d", 1, 1],
        ],
    );
});

test("unknown widgets and widgets over their limit are reported by index", () => {
    const errors = widgetLimitErrors([{ type: "whiteboard" }, { type: "whiteboard" }, { type: "popular_music" }, { type: "image_text" }]);
    assert.deepEqual(Object.keys(errors), ["widgets.1", "widgets.2"]);
    assert.equal(errors["widgets.1"].code, "GUILD_SPACE_WIDGET_LIMIT");
    assert.equal(errors["widgets.2"].code, "GUILD_SPACE_WIDGET_UNAVAILABLE");
    assert.deepEqual(widgetLimitErrors([{ type: "image_text" }, { type: "image_text" }, { type: "image_text" }]), {});
});

test("the leaderboard stat rotates every week", () => {
    const stats = [0, 1, 2, 3].map(leaderboardStat);
    assert.deepEqual(stats, [LeaderboardStat.DAYS_PLAYED, LeaderboardStat.HOURS_PLAYED, LeaderboardStat.UNIQUE_GAMES_PLAYED, LeaderboardStat.DAYS_PLAYED]);
    assert.equal(leaderboardStat(-1), LeaderboardStat.UNIQUE_GAMES_PLAYED);
});

test("days played counts distinct days and breaks ties by time played", () => {
    const rows = [
        play("1", "2026-11-16", "100", 600),
        play("1", "2026-11-17", "100", 600),
        play("2", "2026-11-16", "200", 3600),
        play("2", "2026-11-17", "300", 60),
        play("3", "2026-11-16", "name:celeste", 7200),
    ];
    const entries = rankLeaderboard(rows, LeaderboardStat.DAYS_PLAYED);
    assert.deepEqual(
        entries.map((entry) => [entry.user_id, entry.rank, entry.value, entry.time_played_seconds]),
        [
            ["2", 1, 2, 3660],
            ["1", 2, 2, 1200],
            ["3", 3, 1, 7200],
        ],
    );
    assert.deepEqual(entries[0].application_ids, ["300", "200"]);
    assert.equal(entries[2].application_count, 1);
    assert.deepEqual(entries[2].application_ids, []);
});

test("hours played is sent in milliseconds and unique games counts every game", () => {
    const rows = [play("1", "2026-11-16", "100", 5400), play("1", "2026-11-17", "name:celeste", 600), play("2", "2026-11-16", "100", 7200)];
    assert.deepEqual(
        rankLeaderboard(rows, LeaderboardStat.HOURS_PLAYED).map((entry) => [entry.user_id, entry.value]),
        [
            ["2", 7_200_000],
            ["1", 6_000_000],
        ],
    );
    assert.deepEqual(
        rankLeaderboard(rows, LeaderboardStat.UNIQUE_GAMES_PLAYED).map((entry) => [entry.user_id, entry.value]),
        [
            ["1", 2],
            ["2", 1],
        ],
    );
});

test("popular games ranks games by players and only lists games with an application", () => {
    const rows = [
        play("1", "2026-11-16", "100", 600),
        play("2", "2026-11-16", "100", 60),
        play("2", "2026-11-17", "200", 7200),
        play("3", "2026-11-17", "name:celeste", 9000),
        play("3", "2026-11-17", "100", 0),
    ];
    const result = popularGames(rows);
    assert.deepEqual(
        result.games.map((game) => [game.application_id, game.total_users, game.user_ids]),
        [
            ["100", 2, ["1", "2"]],
            ["200", 1, ["2"]],
        ],
    );
    assert.equal(result.total_users, 3);
    assert.equal(result.total_games, 3);
    assert.deepEqual(result.user_ids, ["3", "2", "1"]);
    const many = popularGames(Array.from({ length: 15 }, (_, index) => play(String(index), "2026-11-16", String(1000 + index), 60)));
    assert.equal(many.games.length, POPULAR_GAMES_SIZE);
});

test("each sampled game becomes one play row and empty samples are skipped", () => {
    assert.deepEqual(
        gamePlayRows([
            { user_id: "1", game_seconds: 60, games: ["100", "100", "name:celeste"] },
            { user_id: "2", game_seconds: 0, games: ["100"] },
            { user_id: "3", game_seconds: 60, games: [] },
        ]),
        [
            { user_id: "1", game: "100", seconds: 60 },
            { user_id: "1", game: "name:celeste", seconds: 60 },
        ],
    );
});
