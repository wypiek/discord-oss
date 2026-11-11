import assert from "node:assert/strict";
import { test } from "node:test";
import { aggregateMetrics, bucketStart, isMetricPeriod, median, METRIC_BUCKET_MS, ResponseTimeBucket } from "./statusMetrics";
import { historyWindow, rollUpGroups } from "./statusPage";

const NOW = Date.parse("2026-11-11T15:42:10.000Z");

test("median handles odd, even and empty sample sets", () => {
    assert.equal(median([5, 1, 3]), 3);
    assert.equal(median([4, 1, 3, 2]), 2.5);
    assert.equal(median([]), 0);
});

test("buckets start on 5 minute boundaries", () => {
    assert.equal(new Date(bucketStart(NOW)).toISOString(), "2026-11-11T15:40:00.000Z");
    assert.equal(METRIC_BUCKET_MS, 300000);
});

test("a bucket counts every request but keeps at most 2000 samples", () => {
    const bucket = new ResponseTimeBucket(0, () => 0.99);
    for (let i = 0; i < 5000; i++) bucket.add(i % 100);
    assert.equal(bucket.requests, 5000);
    assert.equal(bucket.samples.length, 2000);
    assert.equal(bucket.summary().requests, 5000);
});

test("only day, week and month are periods", () => {
    assert.ok(isMetricPeriod("day"));
    assert.ok(isMetricPeriod("week"));
    assert.ok(isMetricPeriod("month"));
    assert.ok(!isMetricPeriod("year"));
    assert.ok(!isMetricPeriod("constructor"));
    assert.ok(!isMetricPeriod(undefined));
});

test("day metrics have 288 points and weight each bucket by its requests", () => {
    const at = new Date(bucketStart(NOW));
    const result = aggregateMetrics(
        [
            { bucket_at: at, requests: 3, median_ms: 100 },
            { bucket_at: at, requests: 1, median_ms: 300 },
            { bucket_at: new Date(NOW - 2 * 24 * 60 * 60 * 1000), requests: 50, median_ms: 9000 },
        ],
        "day",
        NOW,
    );
    assert.equal(result.points.length, 288);
    assert.equal(result.interval_ms, METRIC_BUCKET_MS);
    assert.equal(result.points.at(-1)?.at, at.toISOString());
    assert.equal(result.points.at(-1)?.ms, 150);
    assert.equal(result.points[0].ms, null);
    assert.equal(result.average_ms, 150);
});

test("week and month metrics use hourly and 6 hourly points", () => {
    assert.equal(aggregateMetrics([], "week", NOW).points.length, 168);
    assert.equal(aggregateMetrics([], "month", NOW).points.length, 120);
    assert.equal(aggregateMetrics([], "month", NOW).average_ms, null);
});

const day = (date: string, indicator: "none" | "minor" | "major" | "critical" | null) => ({ date, indicator });
const component = (
    id: string,
    group_id: string | null,
    status: "operational" | "partial_outage" | "major_outage",
    uptime: number,
    indicators: ("none" | "minor" | "major" | "critical" | null)[],
) => ({
    id,
    name: id,
    description: null,
    status,
    position: 0,
    group_id,
    updated_at: new Date(0),
    uptime,
    uptime_days: indicators.map((indicator, i) => day(`2026-11-0${i + 1}`, indicator)),
});

test("groups take their components' worst status and day, and the average uptime", () => {
    const rolled = rollUpGroups([
        component("api", null, "operational", 100, ["none", "none"]),
        component("voice", null, "operational", 100, ["none", "none"]),
        component("eu", "voice", "partial_outage", 99, ["minor", "none"]),
        component("us", "voice", "operational", 98, [null, "critical"]),
    ]);
    assert.deepEqual(
        rolled.map((c) => c.id),
        ["api", "voice"],
    );
    const voice = rolled[1];
    assert.equal(voice.group, true);
    assert.equal(voice.status, "partial_outage");
    assert.equal(voice.uptime, 98.5);
    assert.deepEqual(
        voice.uptime_days.map((d) => d.indicator),
        ["minor", "critical"],
    );
    assert.deepEqual(
        voice.components.map((c) => c.id),
        ["eu", "us"],
    );
    assert.equal(rolled[0].group, false);
});

test("a component whose group is missing or nested stays at the top level", () => {
    const rolled = rollUpGroups([
        component("a", "gone", "operational", 100, ["none"]),
        component("b", null, "operational", 100, ["none"]),
        component("c", "b", "operational", 100, ["none"]),
        component("d", "c", "operational", 100, ["none"]),
    ]);
    assert.deepEqual(
        rolled.map((c) => c.id),
        ["a", "b", "d"],
    );
});

test("history pages cover 3 calendar months each", () => {
    assert.deepEqual(
        Object.values(historyWindow(0, NOW)).map((d) => d.toISOString()),
        ["2026-09-01T00:00:00.000Z", "2026-12-01T00:00:00.000Z"],
    );
    assert.deepEqual(
        Object.values(historyWindow(4, NOW)).map((d) => d.toISOString()),
        ["2025-09-01T00:00:00.000Z", "2025-12-01T00:00:00.000Z"],
    );
});
