import { Member, Recipient, Relationship, Session, User } from "@spacebar/database";
import { Activity, emitEvent, GuildMemberUpdateEvent, Presence, PresenceUpdateEvent, SessionsReplace } from "@spacebar/util";
import { ClientStatus, PublicStatus, PublicUser, RelationshipType } from "@spacebar/schemas";
import { In, Not } from "typeorm";
import { clampText } from "./UserFieldCaps";

export function getMostRelevantSession(sessions: Session[]) {
    const statusMap = {
        online: 0,
        idle: 1,
        dnd: 2,
        invisible: 3,
        offline: 4,
        unknown: 5,
    };
    // sort sessions by relevance
    sessions = sessions.sort((a, b) => statusMap[a.status] - statusMap[b.status] + ((a.activities?.length ?? 0) - (b.activities?.length ?? 0)) * 2);

    return sessions[0];
}

export async function distributePresenceUpdate(userId: string, data: PresenceUpdateEvent) {
    let relationships: Relationship[] | undefined = await Relationship.find({
        where: { from_id: userId, type: RelationshipType.FRIEND },
        select: { from_id: true, to_id: true },
    });
    for (const rel of relationships)
        await emitEvent({
            ...data,
            user_id: rel.to_id,
        });
    // noinspection JSUnusedAssignment - drop array ref
    relationships = undefined;

    let memberGuildIds: string[] | undefined = (
        await Member.find({
            where: { id: userId },
            select: { guild_id: true },
        })
    ).map((x) => x.guild_id);
    for (const rel of memberGuildIds)
        await emitEvent({
            ...data,
            guild_id: rel,
        });
    // noinspection JSUnusedAssignment - drop array ref
    memberGuildIds = undefined;

    const recipients = await Recipient.find({
        where: { user_id: userId, closed: false },
        relations: { channel: true },
    });
    for (const recipient of recipients) {
        const otherRecipients = await Recipient.find({
            where: { user_id: Not(userId), channel_id: recipient.channel_id },
        });
        for (const otherRcpt of otherRecipients) {
            if (otherRcpt.closed) continue;
            await emitEvent({
                ...data,
                user_id: otherRcpt.user_id,
            });
        }
    }
}

export const PRESENCE_STALE_AFTER_MS = 90 * 1000;

export type PresenceSession = Pick<Session, "user_id" | "status" | "activities" | "client_status" | "client_info" | "last_seen">;

export interface AggregatedPresence {
    status: PublicStatus;
    activities: Activity[];
    client_status: ClientStatus;
    processed_at_timestamp: number;
}

const PresencePriority: Record<string, number> = { dnd: 0, online: 1, idle: 2 };
const ClientPlatforms = ["desktop", "mobile", "web", "embedded", "vr"] as const;
export type ClientPlatform = (typeof ClientPlatforms)[number];

export function getClientPlatform(properties?: { browser?: string; $browser?: string; os?: string; $os?: string }): ClientPlatform {
    const browser = (properties?.browser ?? properties?.$browser ?? "").toLowerCase();
    const os = (properties?.os ?? properties?.$os ?? "").toLowerCase();
    if (browser.includes("android") || browser.includes("ios") || os === "android" || os === "ios") return "mobile";
    if (browser === "discord client" || browser.includes("electron")) return "desktop";
    if (browser.includes("embedded")) return "embedded";
    if (browser.includes("vr")) return "vr";
    return "web";
}

const ActivityText: Record<string, number> = {
    name: 128,
    url: 512,
    details: 128,
    details_url: 512,
    state: 128,
    state_url: 512,
    application_id: 32,
    parent_application_id: 32,
    id: 128,
    sync_id: 128,
    session_id: 128,
    platform: 32,
};

const ActivityScalars = ["type", "created_at", "instance", "flags", "status_display_type"];

const ActivityObjects: Record<string, Record<string, number>> = {
    timestamps: {},
    emoji: { name: 32, id: 32 },
    party: { id: 128 },
    assets: { large_image: 1024, large_text: 128, large_url: 512, small_image: 1024, small_text: 128, small_url: 512 },
    secrets: { join: 128, spectate: 128, match: 128 },
    metadata: { context_uri: 512, album_id: 128, type: 32 },
};

const ActivityListItems = 10;
const ActivityListText = 512;
const ActivityFallbackText = 32;
const ActivityButtons = 2;
const ActivityButtonLabel = 32;
const ActivityButtonUrl = 512;

function sanitizeActivityScalar(value: unknown, max: number) {
    if (typeof value === "string") return clampText(value, max);
    if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
    return undefined;
}

function sanitizeActivityObject(value: unknown, caps: Record<string, number>) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const entries = Object.entries(value)
        .slice(0, 16)
        .map(([key, item]): [string, unknown] => {
            if (Array.isArray(item))
                return [
                    key,
                    item
                        .slice(0, ActivityListItems)
                        .map((x) => sanitizeActivityScalar(x, ActivityListText))
                        .filter((x) => x !== undefined),
                ];
            return [key, sanitizeActivityScalar(item, caps[key] ?? ActivityFallbackText)];
        })
        .filter(([key, item]) => item !== undefined && key.length <= 64);
    return Object.fromEntries(entries);
}

function sanitizeActivityButtons(value: unknown) {
    if (!Array.isArray(value)) return undefined;
    return value
        .slice(0, ActivityButtons)
        .map((button) => {
            if (typeof button === "string") return clampText(button, ActivityButtonLabel);
            if (!button || typeof button !== "object") return undefined;
            const { label, url } = button as { label?: unknown; url?: unknown };
            if (typeof label !== "string") return undefined;
            return { label: clampText(label, ActivityButtonLabel), ...(typeof url === "string" && { url: clampText(url, ActivityButtonUrl) }) };
        })
        .filter((button) => button !== undefined);
}

function sanitizeActivity(x: Record<string, unknown>) {
    const activity: Record<string, unknown> = {};
    for (const [key, max] of Object.entries(ActivityText)) if (typeof x[key] === "string") activity[key] = clampText(x[key], max);
    for (const key of ActivityScalars) {
        const value = sanitizeActivityScalar(x[key], ActivityFallbackText);
        if (value !== undefined) activity[key] = value;
    }
    for (const [key, caps] of Object.entries(ActivityObjects)) {
        const value = sanitizeActivityObject(x[key], caps);
        if (value) activity[key] = value;
    }
    if (Array.isArray(x.supported_platforms))
        activity.supported_platforms = x.supported_platforms
            .slice(0, ActivityListItems)
            .map((platform) => clampText(platform, ActivityFallbackText))
            .filter((platform) => platform !== undefined);
    const buttons = sanitizeActivityButtons(x.buttons);
    if (buttons) activity.buttons = buttons;
    return activity;
}

export function sanitizeActivities(activities: unknown, previous: Activity[] = []): Activity[] {
    if (!Array.isArray(activities)) return [];
    return activities
        .filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && typeof x.name === "string" && Number.isInteger(Number(x.type)))
        .slice(0, 10)
        .map((x) => {
            const activity = sanitizeActivity(x);
            activity.type = Number(x.type);
            activity.created_at ??= previous.find((p) => p.type === activity.type && p.name === activity.name)?.created_at ?? Date.now();
            return activity as unknown as Activity;
        });
}

export function isSessionConnected(session: PresenceSession, now = Date.now()) {
    if (!session.status || session.status === "offline") return false;
    return (session.last_seen?.getTime() ?? 0) > now - PRESENCE_STALE_AFTER_MS;
}

export function aggregatePresence(sessions: PresenceSession[]): AggregatedPresence {
    const now = Date.now();
    const visible = sessions.filter((s) => isSessionConnected(s, now) && s.status in PresencePriority);
    if (!visible.length)
        return {
            status: "offline",
            activities: [],
            client_status: {},
            processed_at_timestamp: Date.now(),
        };

    const best = (a: string | undefined, b: string) => (a === undefined || PresencePriority[b] < PresencePriority[a] ? b : a);
    let status: string | undefined;
    const client_status: ClientStatus = {};
    const activities: Activity[] = [];
    const seenActivities = new Set<string>();

    for (const session of visible) {
        status = best(status, session.status);
        const platform = ClientPlatforms.find((x) => x === session.client_info?.platform) ?? "web";
        client_status[platform] = best(client_status[platform], session.status);
        for (const activity of session.activities ?? []) {
            const key = activity.type === 4 ? "custom" : `${activity.type}:${activity.application_id ?? activity.name}`;
            if (seenActivities.has(key)) continue;
            seenActivities.add(key);
            activities.push(activity);
        }
    }

    return {
        status: status as PublicStatus,
        activities,
        client_status,
        processed_at_timestamp: Date.now(),
    };
}

export async function getUserPresences(userIds: string[]) {
    const result = new Map<string, AggregatedPresence>();
    if (!userIds.length) return result;
    const sessions = await Session.find({
        where: { user_id: In(userIds), is_admin_session: false, status: Not("offline") },
        select: {
            user_id: true,
            status: true,
            activities: true,
            client_status: true,
            client_info: true,
            last_seen: true,
        },
    });
    const byUser = new Map<string, Session[]>();
    for (const session of sessions) byUser.set(session.user_id, [...(byUser.get(session.user_id) ?? []), session]);
    for (const [userId, userSessions] of byUser) {
        const presence = aggregatePresence(userSessions);
        if (presence.status !== "offline") result.set(userId, presence);
    }
    return result;
}

export async function getUserPresence(userId: string): Promise<AggregatedPresence> {
    return (
        (await getUserPresences([userId])).get(userId) ?? {
            status: "offline",
            activities: [],
            client_status: {},
            processed_at_timestamp: Date.now(),
        }
    );
}

export async function getConnectedSessions(userId: string) {
    const now = Date.now();
    return (
        await Session.find({
            where: { user_id: userId, is_admin_session: false, status: Not("offline") },
        })
    ).filter((x) => isSessionConnected(x, now));
}

export async function emitSessionsReplace(userId: string) {
    const sessions = await getConnectedSessions(userId);
    await emitEvent({
        event: "SESSIONS_REPLACE",
        user_id: userId,
        data: sessions.map((x) => x.toPrivateGatewayDeviceInfo()),
    } satisfies SessionsReplace);
    return sessions;
}

export async function broadcastPresence(userId: string, user?: PublicUser) {
    const [presence, friends, guilds, recipients] = await Promise.all([
        getUserPresence(userId),
        Relationship.find({
            where: { from_id: userId, type: RelationshipType.FRIEND },
            select: { to_id: true },
        }),
        Member.find({ where: { id: userId }, select: { guild_id: true } }),
        Recipient.find({ where: { user_id: userId, closed: false }, select: { channel_id: true } }),
    ]);

    const data: Presence = { user: user ?? { id: userId }, ...presence };
    await emitEvent({
        event: "PRESENCE_UPDATE",
        user_id: userId,
        data,
    } satisfies PresenceUpdateEvent);
    await Promise.all(
        guilds.map(({ guild_id }) =>
            emitEvent({
                event: "PRESENCE_UPDATE",
                guild_id,
                data: { ...data, guild_id },
            } satisfies PresenceUpdateEvent),
        ),
    );

    if (!recipients.length) return presence;
    const friendIds = new Set(friends.map((x) => x.to_id));
    const others = await Recipient.find({
        where: {
            channel_id: In(recipients.map((x) => x.channel_id)),
            user_id: Not(userId),
            closed: false,
        },
        select: { user_id: true },
    });
    const dmUserIds = new Set(others.map((x) => x.user_id).filter((id) => !friendIds.has(id)));
    await Promise.all([...dmUserIds].map((id) => emitEvent({ event: "PRESENCE_UPDATE", user_id: id, data } satisfies PresenceUpdateEvent)));
    return presence;
}

export async function broadcastUserUpdate(userId: string, pride_badges?: readonly string[]) {
    const [user, members] = await Promise.all([User.getPublicUser(userId), Member.find({ where: { id: userId }, relations: { roles: true } })]);
    if (pride_badges !== undefined) Object.assign(user, { pride_badges: [...pride_badges] });
    await Promise.all(
        members.map((member) =>
            emitEvent({
                event: "GUILD_MEMBER_UPDATE",
                guild_id: member.guild_id,
                data: {
                    ...member.toPublicMember(),
                    guild_id: member.guild_id,
                    user,
                    roles: member.roles.map((x) => x.id).filter((id) => id !== member.guild_id),
                },
            } satisfies GuildMemberUpdateEvent),
        ),
    );
    await broadcastPresence(userId, user);
}
