import { In, IsNull, LessThanOrEqual, Not } from "typeorm";
import { ProcessLifecycle } from "../../util/util/ProcessLifecycle";
import { emitEvent } from "@spacebar/util/util";
import { GuildScheduledEvent, GuildScheduledEventEntityType, GuildScheduledEventStatus, GuildScheduledEventUser } from "../entities/GuildScheduledEvent";

const DAY = 86_400_000;
const SWEEP_BATCH = 100;
const SWEEP_BATCHES = 10;

type RecurrenceRule = {
    end?: string | null;
    frequency?: number;
    interval?: number;
    by_weekday?: number[] | null;
    by_n_weekday?: { n: number; day: number }[] | null;
    count?: number | null;
};

const weekday = (date: Date) => (date.getUTCDay() + 6) % 7;

const nthWeekdayOfMonth = (year: number, month: number, n: number, day: number, template: Date) => {
    const first = new Date(Date.UTC(year, month, 1, template.getUTCHours(), template.getUTCMinutes(), template.getUTCSeconds()));
    const offset = (day - weekday(first) + 7) % 7;
    const result = new Date(first.getTime() + (offset + (n - 1) * 7) * DAY);
    return result.getUTCMonth() === month ? result : null;
};

const step = (from: Date, rule: RecurrenceRule) => {
    const interval = Math.max(1, rule.interval ?? 1);
    switch (rule.frequency) {
        case 0: {
            const next = new Date(from);
            next.setUTCFullYear(next.getUTCFullYear() + interval);
            return next;
        }
        case 1: {
            const nth = rule.by_n_weekday?.[0];
            for (let months = interval; months <= interval * 24; months += interval) {
                const target = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + months, 1));
                if (!nth) {
                    const next = new Date(from);
                    next.setUTCFullYear(target.getUTCFullYear(), target.getUTCMonth(), from.getUTCDate());
                    if (next.getUTCMonth() === target.getUTCMonth()) return next;
                    continue;
                }
                const next = nthWeekdayOfMonth(target.getUTCFullYear(), target.getUTCMonth(), nth.n, nth.day, from);
                if (next) return next;
            }
            return null;
        }
        case 2:
            return new Date(from.getTime() + 7 * interval * DAY);
        case 3: {
            const days = rule.by_weekday?.length ? new Set(rule.by_weekday) : null;
            const first = new Date(from.getTime() + interval * DAY);
            if (!days) return first;
            for (let offset = 0; offset < 7; offset++) {
                const next = new Date(first.getTime() + offset * DAY);
                if (days.has(weekday(next))) return next;
            }
            return null;
        }
        default:
            return null;
    }
};

export class ScheduledEvents {
    private static sweeper?: NodeJS.Timeout;
    private static sweeping: Promise<void> | undefined;
    private static stopping = false;

    static async userCounts(eventIds: string[]) {
        if (!eventIds.length) return new Map<string, number>();
        const rows = await GuildScheduledEventUser.createQueryBuilder("u")
            .select("u.guild_scheduled_event_id", "id")
            .addSelect("COUNT(*)", "count")
            .where({
                guild_scheduled_event_id: In(eventIds),
                guild_scheduled_event_exception_id: IsNull(),
                response: 1,
            })
            .groupBy("u.guild_scheduled_event_id")
            .getRawMany<{ id: string; count: string }>();
        return new Map(rows.map((row) => [String(row.id), Number(row.count)]));
    }

    static async serialize(event: GuildScheduledEvent) {
        const counts = await ScheduledEvents.userCounts([event.id]);
        return event.toJSON(counts.get(event.id) ?? 0);
    }

    static async forGuilds(guildIds: string[]) {
        if (!guildIds.length) return [];
        return GuildScheduledEvent.find({
            where: {
                guild_id: In(guildIds),
                status: In([GuildScheduledEventStatus.SCHEDULED, GuildScheduledEventStatus.ACTIVE]),
            },
            relations: { creator: true },
            order: { scheduled_start_time: "ASC" },
        });
    }

    static async publish(event: GuildScheduledEvent, type: "GUILD_SCHEDULED_EVENT_CREATE" | "GUILD_SCHEDULED_EVENT_UPDATE" | "GUILD_SCHEDULED_EVENT_DELETE") {
        const data = await ScheduledEvents.serialize(event);
        await emitEvent({ event: type, guild_id: event.guild_id, data });
        return data;
    }

    static async setStatus(event: GuildScheduledEvent, status: GuildScheduledEventStatus, changes: Partial<Pick<GuildScheduledEvent, "entity_id">> = {}) {
        const current = { id: event.id, status: event.status, scheduled_start_time: event.scheduled_start_time };
        const written: Partial<Pick<GuildScheduledEvent, "status" | "entity_id" | "scheduled_start_time" | "scheduled_end_time">> = { ...changes, status };
        if (status === GuildScheduledEventStatus.COMPLETED && event.recurrence_rule) {
            const rescheduled = ScheduledEvents.nextOccurrence(event);
            if (rescheduled)
                Object.assign(written, rescheduled, {
                    status: GuildScheduledEventStatus.SCHEDULED,
                    entity_id: null,
                });
        }
        const { affected } = await GuildScheduledEvent.update(current, written);
        if (!affected) {
            const latest = await GuildScheduledEvent.findOne({ where: { id: event.id }, relations: { creator: true } });
            return ScheduledEvents.serialize(latest ?? event);
        }
        Object.assign(event, written);
        return ScheduledEvents.publish(event, "GUILD_SCHEDULED_EVENT_UPDATE");
    }

    static nextOccurrence(event: GuildScheduledEvent) {
        const rule = event.recurrence_rule as RecurrenceRule | null;
        if (!rule) return null;
        const start = new Date(event.scheduled_start_time);
        const duration = event.scheduled_end_time ? new Date(event.scheduled_end_time).getTime() - start.getTime() : null;
        const end = rule.end ? new Date(rule.end).getTime() : Infinity;
        const canceled = new Set(event.exceptions.filter((e) => e.is_canceled).map((e) => new Date(e.original_scheduled_start_time).getTime()));
        let next: Date | null = start;
        for (let i = 0; i < 1000 && next; i++) {
            next = step(next, rule);
            if (!next || next.getTime() > end) return null;
            if (next.getTime() > Date.now() && !canceled.has(next.getTime())) break;
        }
        if (!next) return null;
        return {
            scheduled_start_time: next,
            scheduled_end_time: duration !== null ? new Date(next.getTime() + duration) : null,
        };
    }

    static async stageStarted(eventId: string | null | undefined, guildId: string, stageInstanceId: string) {
        if (!eventId) return;
        const event = await GuildScheduledEvent.findOne({
            where: { id: eventId, guild_id: guildId },
            relations: { creator: true },
        });
        if (!event || event.status !== GuildScheduledEventStatus.SCHEDULED) return;
        await ScheduledEvents.setStatus(event, GuildScheduledEventStatus.ACTIVE, {
            entity_id: stageInstanceId,
        });
    }

    static async channelEnded(channelId: string) {
        const events = await GuildScheduledEvent.find({
            where: {
                channel_id: channelId,
                status: GuildScheduledEventStatus.ACTIVE,
                entity_type: Not(GuildScheduledEventEntityType.EXTERNAL),
            },
            relations: { creator: true },
        });
        for (const event of events) await ScheduledEvents.setStatus(event, GuildScheduledEventStatus.COMPLETED);
    }

    static sweep() {
        if (this.sweeping) return this.sweeping;
        if (this.stopping) return Promise.resolve();
        this.sweeping = this.sweepOnce().finally(() => {
            this.sweeping = undefined;
        });
        return this.sweeping;
    }

    private static async sweepOnce() {
        const now = new Date();
        for (let batch = 0; batch < SWEEP_BATCHES; batch++) {
            const starting = await GuildScheduledEvent.find({
                where: [
                    {
                        status: GuildScheduledEventStatus.SCHEDULED,
                        entity_type: GuildScheduledEventEntityType.EXTERNAL,
                        scheduled_start_time: LessThanOrEqual(now),
                    },
                    {
                        status: GuildScheduledEventStatus.SCHEDULED,
                        auto_start: true,
                        scheduled_start_time: LessThanOrEqual(now),
                    },
                ],
                relations: { creator: true },
                order: { scheduled_start_time: "ASC", id: "ASC" },
                take: SWEEP_BATCH,
            });
            for (const event of starting) {
                if (this.stopping) return;
                await ScheduledEvents.setStatus(event, GuildScheduledEventStatus.ACTIVE);
            }
            if (starting.length < SWEEP_BATCH) break;
        }
        for (let batch = 0; batch < SWEEP_BATCHES; batch++) {
            if (this.stopping) return;
            const ending = await GuildScheduledEvent.find({
                where: {
                    status: GuildScheduledEventStatus.ACTIVE,
                    entity_type: GuildScheduledEventEntityType.EXTERNAL,
                    scheduled_end_time: LessThanOrEqual(now),
                },
                relations: { creator: true },
                order: { scheduled_end_time: "ASC", id: "ASC" },
                take: SWEEP_BATCH,
            });
            for (const event of ending) {
                if (this.stopping) return;
                await ScheduledEvents.setStatus(event, GuildScheduledEventStatus.COMPLETED);
            }
            if (ending.length < SWEEP_BATCH) break;
        }
    }

    static startSweeper(intervalMs = 30_000) {
        if (this.sweeper || this.stopping) return;
        this.sweeper = setInterval(() => void this.sweep().catch((error) => console.error("[ScheduledEvents] sweep failed", error)), intervalMs).unref();
        ProcessLifecycle.eventEmitter.once("stopping", async () => {
            this.stopping = true;
            clearInterval(this.sweeper);
            await Promise.allSettled(this.sweeping ? [this.sweeping] : []);
        });
    }
}
