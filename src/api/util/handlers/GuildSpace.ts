import { In } from "typeorm";
import { Application, Channel, Guild, User, UserSettingsProtos } from "@spacebar/database";
import {
    ChannelType,
    GuildSpacePublishStatus,
    GuildSpaceSettings,
    guildSpaceSettingsOf,
    GuildSpaceSettingsModifySchema,
    GuildSpaceState,
    GuildSpaceStoredWidget,
    GuildSpaceUpdateSchema,
    GuildSpaceWidgetConfig,
    GuildSpaceWidgetType,
    GuildSpaceWidgetUpdate,
} from "@spacebar/schemas";
import { Config, FieldErrors, gamePlayForGuild, GamePlayRow, handleFile, hasPersonalizationConsent, playDay, Snowflake } from "@spacebar/util";
import { DetectableGames } from "../utility/games";
import { queueImageFileDeletes } from "./ImageFiles";

const DAY = 86_400_000;
const WEEK = 7 * DAY;
const FIRST_MONDAY = 4 * DAY;
const HYDRATION_CACHE_MS = 60_000;
const MAX_HYDRATION_CACHE_ENTRIES = 512;
export const LEADERBOARD_SIZE = 50;
export const POPULAR_GAMES_SIZE = 10;
export const POPULAR_GAMES_USER_IDS = 20;
const ENTRY_APPLICATION_IDS = 5;
const SPACE_CHANNEL_NAME = "server-hub";
export const MAX_IMAGE_TEXT_TITLE = 100;
export const MAX_IMAGE_TEXT_TEXT = 500;

export const LeaderboardStat = { HOURS_PLAYED: 1, DAYS_PLAYED: 2, UNIQUE_GAMES_PLAYED: 3 } as const;
const STAT_ROTATION = [LeaderboardStat.DAYS_PLAYED, LeaderboardStat.HOURS_PLAYED, LeaderboardStat.UNIQUE_GAMES_PLAYED];

type CatalogEntry = { type: GuildSpaceWidgetType; name: string; max_instances: number; requires_hydration: boolean; image: string };

export const GUILD_SPACE_CATALOG: CatalogEntry[] = [
    {
        type: "leaderboard",
        name: "Gaming Leaderboard",
        max_instances: 1,
        requires_hydration: true,
        image: "58e54efe82f33e76cc9388d9907b1684625b43f15aa5bc7f85752f0f3d4e9be7.svg",
    },
    {
        type: "popular_games",
        name: "Popular Games",
        max_instances: 1,
        requires_hydration: true,
        image: "d561fd91d87017743133e6f7c82388345a8938aa2434a28cc42077d126076514.svg",
    },
    {
        type: "whiteboard",
        name: "Whiteboard",
        max_instances: 1,
        requires_hydration: false,
        image: "b501ac4c5a78c462100d3870ce7ab50a78ea7d9b2af6b8ee7a08b11bab82fb01.svg",
    },
    {
        type: "image_text",
        name: "Image and Text",
        max_instances: 3,
        requires_hydration: false,
        image: "1c5d5dd760fa15de3c2ad23c6b191aa9fd5eefde3c29367503b5d90af485a3e3.svg",
    },
];

const catalogEntry = (type: string) => GUILD_SPACE_CATALOG.find((entry) => entry.type === type);

export const DEFAULT_GUILD_SPACE_WIDGETS: GuildSpaceStoredWidget[] = [
    { id: "1", type: "leaderboard", position: { column: 0, order: 0 }, config: { type: "leaderboard" } },
    { id: "2", type: "whiteboard", position: { column: 0, order: 1 }, config: { type: "whiteboard" } },
    { id: "3", type: "popular_games", position: { column: 1, order: 0 }, config: { type: "popular_games" } },
];

const cdnUrl = (path: string) => `${(Config.get().cdn.endpointPublic ?? "").replace(/\/+$/, "")}${path}`;

export function guildSpaceCatalog() {
    return {
        widgets: GUILD_SPACE_CATALOG.map((entry) => ({
            type: entry.type,
            name: entry.name,
            max_instances: entry.max_instances,
            boost_price: 0,
            powerup_sku_id: null,
            locked: false,
            assets: {
                catalog_image_static_url: cdnUrl(`/content-assets/${entry.image}`),
                catalog_image_animated_url: null,
            },
        })),
    };
}

export const guildSpaceWidgets = (state?: GuildSpaceState | null) => state?.widgets ?? DEFAULT_GUILD_SPACE_WIDGETS;

export function canViewGuildSpace(settings: GuildSpaceSettings, canManage: boolean) {
    return settings.enabled && (canManage || settings.publish_status === GuildSpacePublishStatus.PUBLISHED);
}

export function orderedWidgets(widgets: GuildSpaceStoredWidget[]) {
    const columns: GuildSpaceStoredWidget[][] = [[], []];
    for (const widget of widgets) columns[widget.position.column === 1 ? 1 : 0].push(widget);
    return columns.flatMap((column, index) =>
        column
            .map((widget, input) => ({ widget, input }))
            .sort((a, b) => a.widget.position.order - b.widget.position.order || a.input - b.input)
            .map(({ widget }, order) => ({ ...widget, position: { column: index, order } })),
    );
}

export function serializeWidget(widget: GuildSpaceStoredWidget) {
    const entry = catalogEntry(widget.type);
    return {
        id: widget.id,
        type: widget.type,
        position: widget.position,
        config: { ...widget.config, type: widget.type },
        requires_hydration: entry?.requires_hydration ?? false,
        default_title: entry?.name ?? null,
        locked: false,
    };
}

export function serializeGuildSpace(guild: Pick<Guild, "id" | "guild_space">) {
    const state = guild.guild_space;
    return {
        guild_id: guild.id,
        channel_id: state?.channel_id ?? null,
        header: { custom_banner_hash: state?.custom_banner_hash ?? null },
        widgets: orderedWidgets(guildSpaceWidgets(state).filter((widget) => catalogEntry(widget.type))).map(serializeWidget),
    };
}

const channelLocks = new Map<string, Promise<string>>();

export async function ensureGuildSpaceChannel(guildId: string): Promise<string> {
    const pending = channelLocks.get(guildId);
    if (pending) return pending;
    const task = (async () => {
        const guild = await Guild.findOneOrFail({ where: { id: guildId }, select: { id: true, guild_space: true } });
        const current = guild.guild_space?.channel_id;
        if (current && (await Channel.exists({ where: { id: current, guild_id: guildId, type: ChannelType.GUILD_SPACE } }))) return current;
        const existing = await Channel.findOne({ where: { guild_id: guildId, type: ChannelType.GUILD_SPACE }, select: { id: true } });
        const channelId =
            existing?.id ??
            (
                await Channel.createChannel({ guild_id: guildId, type: ChannelType.GUILD_SPACE, name: SPACE_CHANNEL_NAME }, undefined, {
                    skipPermissionCheck: true,
                    skipNameChecks: true,
                })
            ).id;
        const fresh = await Guild.findOneOrFail({ where: { id: guildId }, select: { id: true, guild_space: true } });
        await Guild.update({ id: guildId }, { guild_space: { ...guildSpaceSettingsOf(fresh.guild_space), ...fresh.guild_space, channel_id: channelId } });
        return channelId;
    })().finally(() => channelLocks.delete(guildId));
    channelLocks.set(guildId, task);
    return task;
}

export async function loadGuildSpace(guildId: string) {
    let guild = await Guild.findOneOrFail({ where: { id: guildId }, select: { id: true, guild_space: true } });
    if (guildSpaceWidgets(guild.guild_space).some((widget) => widget.type === "whiteboard") && !guild.guild_space?.channel_id) {
        await ensureGuildSpaceChannel(guildId);
        guild = await Guild.findOneOrFail({ where: { id: guildId }, select: { id: true, guild_space: true } });
    }
    return guild;
}

const trimmedText = (value: string | null | undefined, max: number) => {
    const text = value?.trim();
    return text ? text.slice(0, max) : null;
};

type WidgetError = { code: string; message: string };

async function widgetConfig(
    guildId: string,
    id: string,
    incoming: GuildSpaceWidgetUpdate,
    existing: GuildSpaceStoredWidget | undefined,
): Promise<GuildSpaceWidgetConfig | WidgetError> {
    if (incoming.type !== "image_text") return { type: incoming.type };
    const config = incoming.config ?? { type: "image_text" };
    let image_hash = existing?.type === "image_text" ? (existing.config.image_hash ?? null) : null;
    if (config.image === null) image_hash = null;
    else if (typeof config.image === "string" && config.image.startsWith("data:"))
        image_hash = (await handleFile(`/guild-space/${guildId}/image-text-widget/${id}`, config.image)) ?? image_hash;
    const text = trimmedText(config.text, MAX_IMAGE_TEXT_TEXT);
    if (!text && !image_hash) return { code: "GUILD_SPACE_WIDGET_EMPTY", message: "Add some text or an image." };
    return { type: "image_text", title: trimmedText(config.title, MAX_IMAGE_TEXT_TITLE), text, image_hash };
}

const isWidgetError = (value: GuildSpaceWidgetConfig | WidgetError): value is WidgetError => "code" in value;

export function widgetLimitErrors(widgets: Pick<GuildSpaceWidgetUpdate, "type">[]) {
    const errors: Record<string, WidgetError> = {};
    const counts = new Map<string, number>();
    widgets.forEach((widget, index) => {
        const entry = catalogEntry(widget.type);
        if (!entry) {
            errors[`widgets.${index}`] = { code: "GUILD_SPACE_WIDGET_UNAVAILABLE", message: "This widget isn't available on this server." };
            return;
        }
        const count = (counts.get(widget.type) ?? 0) + 1;
        counts.set(widget.type, count);
        if (count > entry.max_instances)
            errors[`widgets.${index}`] = {
                code: "GUILD_SPACE_WIDGET_LIMIT",
                message: entry.max_instances === 1 ? "You can only add this widget once." : `You can add this widget up to ${entry.max_instances} times.`,
            };
    });
    return errors;
}

export async function updateGuildSpace(guildId: string, body: GuildSpaceUpdateSchema) {
    const guild = await Guild.findOneOrFail({ where: { id: guildId }, select: { id: true, guild_space: true } });
    const state: GuildSpaceState = { ...guildSpaceSettingsOf(guild.guild_space), ...guild.guild_space };
    const previous = guildSpaceWidgets(state);
    const previousById = new Map(previous.map((widget) => [widget.id, widget]));

    const errors = widgetLimitErrors(body.widgets);
    if (Object.keys(errors).length) throw FieldErrors(errors);

    const used = new Set<string>();
    const widgets: GuildSpaceStoredWidget[] = [];
    for (const [index, incoming] of body.widgets.entries()) {
        const existing = incoming.id ? previousById.get(incoming.id) : undefined;
        const id = existing && existing.type === incoming.type && !used.has(existing.id) ? existing.id : Snowflake.generate();
        used.add(id);
        const config = await widgetConfig(guildId, id, incoming, existing?.id === id ? existing : undefined);
        if (isWidgetError(config)) {
            errors[`widgets.${index}`] = config;
            continue;
        }
        widgets.push({ id, type: incoming.type, position: { column: incoming.position.column === 1 ? 1 : 0, order: incoming.position.order }, config });
    }
    if (Object.keys(errors).length) throw FieldErrors(errors);

    const banner = body.header?.custom_banner;
    if (banner === null) state.custom_banner_hash = null;
    else if (typeof banner === "string" && banner.startsWith("data:"))
        state.custom_banner_hash = (await handleFile(`/guild-space/${guildId}/banner`, banner)) ?? state.custom_banner_hash;

    state.widgets = orderedWidgets(widgets);
    await Guild.update({ id: guildId }, { guild_space: state });

    const kept = new Set(state.widgets.flatMap((widget) => (widget.config.image_hash ? [`${widget.id}/${widget.config.image_hash}`] : [])));
    const replaced = previous
        .filter((widget) => widget.config.image_hash && !kept.has(`${widget.id}/${widget.config.image_hash}`))
        .map((widget) => `guild-space/${guildId}/image-text-widget/${widget.id}/${widget.config.image_hash}`);
    const previousBanner = guild.guild_space?.custom_banner_hash;
    if (previousBanner && previousBanner !== state.custom_banner_hash) replaced.push(`guild-space/${guildId}/banner/${previousBanner}`);
    await queueImageFileDeletes(replaced);
    for (const type of new Set(previous.map((widget) => widget.type))) hydrationCache.delete(`${guildId}:${type}`);

    return loadGuildSpace(guildId);
}

export async function updateGuildSpaceSettings(guildId: string, body: GuildSpaceSettingsModifySchema) {
    const guild = await Guild.findOneOrFail({ where: { id: guildId }, select: { id: true, guild_space: true } });
    const settings = guildSpaceSettingsOf(guild.guild_space);
    if (body.enabled !== undefined) settings.enabled = body.enabled;
    if (body.publish_status !== undefined) settings.publish_status = body.publish_status;
    if (!settings.enabled) settings.publish_status = GuildSpacePublishStatus.DRAFT;
    await Guild.update({ id: guildId }, { guild_space: { ...guild.guild_space, ...settings } });
    await Guild.emitUpdate(guildId);
    return settings;
}

const weekIndex = (ms: number) => Math.floor((ms - FIRST_MONDAY) / WEEK);
const weekStart = (index: number) => index * WEEK + FIRST_MONDAY;
export const leaderboardStat = (index: number) => STAT_ROTATION[((index % STAT_ROTATION.length) + STAT_ROTATION.length) % STAT_ROTATION.length];

const gameNameIndexes = new WeakMap<object, Map<string, string>>();

async function applicationIdsFor(keys: Iterable<string>) {
    const resolved = new Map<string, string>();
    const names: string[] = [];
    const ids: string[] = [];
    for (const key of keys) {
        if (key.startsWith("name:")) names.push(key);
        else if (/^\d{1,20}$/.test(key)) ids.push(key);
    }
    if (!names.length && !ids.length) return resolved;
    const index = await DetectableGames.load().catch(() => null);
    const local = ids.filter((id) => !index?.byId.has(id));
    const applications = new Set(local.length ? (await Application.find({ where: { id: In(local) }, select: { id: true } })).map((application) => application.id) : []);
    for (const id of ids) if (index?.byId.has(id) || applications.has(id)) resolved.set(id, id);
    if (!index || !names.length) return resolved;
    let byName = gameNameIndexes.get(index);
    if (!byName) {
        byName = new Map();
        for (const game of index.games)
            for (const name of [game.name, ...(game.aliases ?? [])]) {
                const normalized = name?.trim().toLowerCase();
                if (normalized && !byName.has(normalized)) byName.set(normalized, game.id);
            }
        gameNameIndexes.set(index, byName);
    }
    for (const key of names) {
        const id = byName.get(key.slice(5));
        if (id) resolved.set(key, id);
    }
    return resolved;
}

export async function activitySharingUsers(guildId: string, userIds: string[]) {
    const sharing = new Set<string>();
    if (!userIds.length) return sharing;
    const users = await User.find({ where: { id: In(userIds), bot: false }, select: { id: true, account_preferences: true } });
    const consenting = users.filter(hasPersonalizationConsent).map((user) => user.id);
    if (!consenting.length) return sharing;
    const protos = new Map((await UserSettingsProtos.find({ where: { user_id: In(consenting) } })).map((proto) => [proto.user_id, proto]));
    for (const userId of consenting) {
        const settings = protos.get(userId)?.userSettings;
        if (settings?.status?.showCurrentGame?.value === false) continue;
        if (settings?.privacy?.activityRestrictedGuildIds.some((id) => String(id) === guildId)) continue;
        sharing.add(userId);
    }
    return sharing;
}

async function sharedPlay(guildId: string, fromDay: string, toDay: string) {
    const rows = await gamePlayForGuild(guildId, fromDay, toDay);
    const sharing = await activitySharingUsers(guildId, [...new Set(rows.map((row) => row.user_id))]);
    const shared = rows.filter((row) => sharing.has(row.user_id));
    const applications = await applicationIdsFor(new Set(shared.map((row) => row.game)));
    return shared.map((row) => ({ ...row, game: applications.get(row.game) ?? row.game, application_id: applications.get(row.game) ?? null }));
}

export function knownGame(row: { game: string; application_id: string | null }) {
    return row.application_id !== null && row.application_id === row.game;
}

type SharedRow = GamePlayRow & { application_id: string | null };

export type LeaderboardEntry = {
    user_id: string;
    rank: number;
    value: number;
    time_played_seconds: number;
    application_ids: string[];
    application_count: number;
};

export function rankLeaderboard(rows: SharedRow[], stat: number): LeaderboardEntry[] {
    const users = new Map<string, { days: Set<string>; seconds: number; games: Map<string, number>; applications: Map<string, number> }>();
    for (const row of rows) {
        if (row.seconds <= 0) continue;
        const user = users.get(row.user_id) ?? { days: new Set(), seconds: 0, games: new Map(), applications: new Map() };
        user.days.add(row.day);
        user.seconds += row.seconds;
        const at = row.last_played_at.getTime();
        user.games.set(row.game, Math.max(user.games.get(row.game) ?? 0, at));
        if (row.application_id) user.applications.set(row.application_id, Math.max(user.applications.get(row.application_id) ?? 0, at));
        users.set(row.user_id, user);
    }
    return [...users.entries()]
        .map(([user_id, user]) => ({
            user_id,
            value: stat === LeaderboardStat.DAYS_PLAYED ? user.days.size : stat === LeaderboardStat.UNIQUE_GAMES_PLAYED ? user.games.size : user.seconds * 1000,
            time_played_seconds: user.seconds,
            application_ids: [...user.applications.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, ENTRY_APPLICATION_IDS)
                .map(([id]) => id),
            application_count: user.games.size,
        }))
        .sort((a, b) => b.value - a.value || b.time_played_seconds - a.time_played_seconds || (BigInt(a.user_id) < BigInt(b.user_id) ? -1 : 1))
        .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

export function popularGames(rows: SharedRow[]) {
    const games = new Map<string, { users: Map<string, number>; seconds: number; known: boolean }>();
    const players = new Map<string, number>();
    for (const row of rows) {
        if (row.seconds <= 0) continue;
        players.set(row.user_id, (players.get(row.user_id) ?? 0) + row.seconds);
        const game = games.get(row.game) ?? { users: new Map(), seconds: 0, known: knownGame(row) };
        game.users.set(row.user_id, (game.users.get(row.user_id) ?? 0) + row.seconds);
        game.seconds += row.seconds;
        games.set(row.game, game);
    }
    const byTime = (map: Map<string, number>) => [...map.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    return {
        games: [...games.entries()]
            .filter(([, game]) => game.known)
            .sort((a, b) => b[1].users.size - a[1].users.size || b[1].seconds - a[1].seconds)
            .slice(0, POPULAR_GAMES_SIZE)
            .map(([application_id, game]) => ({ application_id, total_users: game.users.size, user_ids: byTime(game.users).slice(0, POPULAR_GAMES_USER_IDS) })),
        user_ids: byTime(players).slice(0, POPULAR_GAMES_USER_IDS),
        total_users: players.size,
        total_games: games.size,
    };
}

const hydrationCache = new Map<string, { at: number; value: Promise<unknown> }>();

function cached<T>(key: string, compute: () => Promise<T>): Promise<T> {
    const hit = hydrationCache.get(key);
    if (hit && Date.now() - hit.at < HYDRATION_CACHE_MS) return hit.value as Promise<T>;
    if (hydrationCache.size >= MAX_HYDRATION_CACHE_ENTRIES) for (const [entry, { at }] of hydrationCache) if (Date.now() - at >= HYDRATION_CACHE_MS) hydrationCache.delete(entry);
    if (hydrationCache.size >= MAX_HYDRATION_CACHE_ENTRIES) hydrationCache.delete(hydrationCache.keys().next().value!);
    const value = compute();
    hydrationCache.set(key, { at: Date.now(), value });
    value.catch(() => hydrationCache.delete(key));
    return value;
}

async function leaderboardStandings(guildId: string, now: number) {
    const index = weekIndex(now);
    const start = weekStart(index);
    const rows = await sharedPlay(guildId, playDay(start), playDay(start + WEEK));
    const stat = leaderboardStat(index);
    return {
        stat,
        next_stat: leaderboardStat(index + 1),
        week_start_ts: Math.floor(start / 1000),
        day_pt: playDay(now),
        computed_at: new Date(now).toISOString(),
        entries: rankLeaderboard(rows, stat),
    };
}

export async function hydrateLeaderboard(guildId: string, userId: string, now = Date.now()) {
    const standings = await cached(`${guildId}:leaderboard`, () => leaderboardStandings(guildId, now));
    const top = standings.entries.slice(0, LEADERBOARD_SIZE);
    const own = standings.entries.find((entry) => entry.user_id === userId);
    return { ...standings, entries: own && !top.includes(own) ? [...top, own] : top };
}

export async function hydratePopularGames(guildId: string, now = Date.now()) {
    return cached(`${guildId}:popular_games`, async () => popularGames(await sharedPlay(guildId, playDay(now - 6 * DAY), playDay(now + DAY))));
}

export async function hydrateGuildSpace(guild: Pick<Guild, "id" | "guild_space">, userId: string, widgetIds: string[]) {
    const wanted = new Set(widgetIds);
    const widgets = guildSpaceWidgets(guild.guild_space).filter((widget) => wanted.has(widget.id) && catalogEntry(widget.type)?.requires_hydration);
    const hydrated = [];
    for (const widget of widgets) {
        if (widget.type === "leaderboard") hydrated.push({ id: widget.id, data: await hydrateLeaderboard(guild.id, userId) });
        else if (widget.type === "popular_games") hydrated.push({ id: widget.id, data: await hydratePopularGames(guild.id) });
    }
    return { widgets: hydrated };
}
