import assert from "node:assert/strict";
import { test } from "node:test";
import { TIERED_BADGES } from "@spacebar/util";
import { applyBadgeOverrides } from "../../routes/admin/users/#user_id/badge-overrides";
import { accountAgeProgress, activityTierProgress, arrangeProfileBadges, nitroProgress, normalizeBadgeSettings, ProfileBadge, publicProfileBadges } from "./profileBadges";

const NOW = new Date("2026-11-11T12:00:00.000Z");
const tiered = (id: number) => TIERED_BADGES.find((badge) => badge.id === id)!;

test("account age matches Discord's numbers for a 9 years 5 months old account", () => {
    const created = new Date("2017-05-29T13:44:03.514Z");
    const progress = accountAgeProgress(created, NOW);
    assert.equal(progress.value, 9);
    assert.equal(progress.info_label, "9 years, 5 months");
    assert.equal(progress.unlocked_at.nine_years, "2026-05-29T13:44:03.514Z");
    assert.equal(progress.unlocked_at.ten_years, undefined);
    assert.equal(progress.progress.floor, 3287);
    assert.equal(progress.progress.threshold, 3652);
    assert.equal(progress.progress.unit, "days");
    assert.equal(progress.progress.progress_helper_text, "7 more months");
});

test("a new account has no account age level yet", () => {
    const progress = accountAgeProgress(new Date("2026-11-01T00:00:00.000Z"), NOW);
    assert.deepEqual(progress.unlocked_at, {});
    assert.equal(progress.info_label, "Less than a month");
    assert.equal(progress.progress.floor, 0);
});

test("activity tiers report Discord's helper texts", () => {
    const streaming = activityTierProgress(tiered(19), 20.1, { newcomer: "a", fledgling: "b", breakout: "c" });
    assert.deepEqual(Object.keys(streaming.unlocked_at), ["newcomer", "fledgling", "breakout"]);
    assert.equal(streaming.info_label, "20 hours streamed to others");
    assert.equal(streaming.progress.progress_helper_text, "55 more hours");
    assert.equal(activityTierProgress(tiered(20), 5, {}).progress.progress_helper_text, "15 more hours of games");
    assert.equal(activityTierProgress(tiered(21), 2, {}).progress.progress_helper_text, "3 more games");
    assert.equal(activityTierProgress(tiered(21), 1, {}).info_label, "1 game played");
    assert.equal(activityTierProgress(tiered(20), 0, {}).info_label, null);
    const maxed = activityTierProgress(tiered(21), 150, {});
    assert.equal(maxed.progress.threshold, null);
    assert.equal(maxed.progress.progress_helper_text, null);
});

test("the Features badge levels up with the months since it started", () => {
    const progress = nitroProgress(new Date("2026-05-10T12:00:00.000Z"), NOW);
    assert.deepEqual(Object.keys(progress.unlocked_at), ["starter", "bronze", "silver", "gold"]);
    assert.equal(progress.info_label, "6 months of Features");
    assert.equal(progress.progress.progress_helper_text, "6 more months");
    assert.deepEqual(nitroProgress(new Date("2026-12-01T00:00:00.000Z"), NOW).unlocked_at, {});
    assert.equal(nitroProgress(new Date("2020-11-10T12:00:00.000Z"), NOW).info_label, "6 years of Features");
    assert.equal(nitroProgress(new Date("2025-08-10T12:00:00.000Z"), NOW).info_label, "1 year, 3 months of Features");
});

test("admins pick a Features level, a start date or rarities", () => {
    const gold = applyBadgeOverrides({}, { nitro_tier: "gold" }, NOW);
    assert.equal(Object.keys(nitroProgress(new Date(gold.nitro_since!), NOW).unlocked_at).at(-1), "gold");
    assert.deepEqual(applyBadgeOverrides(gold, { nitro_tier: null }, NOW), {});
    assert.throws(() => applyBadgeOverrides({}, { nitro_tier: "diamonds" }, NOW));
    assert.throws(() => applyBadgeOverrides({}, { nitro_since: "2030-01-01T00:00:00.000Z" }, NOW));
    const rare = applyBadgeOverrides({}, { rarity: { "2": 3, "123456": 5 } }, NOW);
    assert.deepEqual(rare.rarity, { "2": 3, "123456": 5 });
    assert.deepEqual(applyBadgeOverrides(rare, { rarity: { "2": null, "123456": null } }, NOW), {});
    assert.throws(() => applyBadgeOverrides({}, { rarity: { "2": 4 as never } }, NOW));
});

const badge = (id: string, settings_id: string): ProfileBadge => ({ id, description: id, icon: "", settings_id });

test("settings saved with old badge row ids keep working after the switch to directory ids", () => {
    const badges = [badge("staff", "22"), badge("partner", "2"), badge("account_age", "18"), badge("998877", "998877")];
    const settings = normalizeBadgeSettings({ display_order: ["account_age", "partner", "998877"], hidden_badges: ["998877"] }, badges);
    assert.deepEqual(settings, { display_order: ["18", "2", "998877"], hidden_badges: ["998877"] });
    const { visible, hidden } = arrangeProfileBadges(badges, { display_order: ["18", "2"], hidden_badges: ["998877"] });
    assert.deepEqual(
        visible.map((item) => item.id),
        ["account_age", "partner", "staff"],
    );
    assert.deepEqual(
        hidden.map((item) => item.id),
        ["998877"],
    );
    assert.equal("settings_id" in publicProfileBadges(visible)[0], false);
});

test("admins set any level of the levelled badges and it keeps counting from there", () => {
    const real = { 19: 20, 20: 5, 21: 2 };
    const set = applyBadgeOverrides({}, { levels: { "18": "five_years", "19": "star", "20": "eternal", "21": "dabbler" } }, NOW, real);
    assert.equal(Object.keys(accountAgeProgress(new Date(set.account_age_since!), NOW).unlocked_at).at(-1), "five_years");
    assert.deepEqual(set.progress_offsets, { "19": 480, "20": 4995, "21": 3 });
    assert.equal(set.levels_set_at?.["19"], NOW.toISOString());
    const star = activityTierProgress(tiered(19), real[19] + set.progress_offsets!["19"], {}, set.levels_set_at!["19"]);
    assert.equal(Object.keys(star.unlocked_at).at(-1), "star");
    assert.equal(star.unlocked_at.newcomer, NOW.toISOString());
    const lower = applyBadgeOverrides({}, { levels: { "19": "newcomer" } }, NOW, { 19: 300, 20: 0, 21: 0 });
    assert.equal(lower.progress_offsets?.["19"], -299);
    assert.deepEqual(applyBadgeOverrides(set, { levels: { "18": null, "19": null, "20": null, "21": null } }, NOW, real), {});
    assert.throws(() => applyBadgeOverrides({}, { levels: { "19": "seed" } }, NOW, real));
    assert.throws(() => applyBadgeOverrides({}, { levels: { "2": "seed" } }, NOW, real));
});
