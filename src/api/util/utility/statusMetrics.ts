import { NextFunction, Request, Response } from "express";
import { Between, LessThan } from "typeorm";
import { StatusMetric } from "@spacebar/database";

export const METRIC_BUCKET_MS = 5 * 60 * 1000;
const SAMPLE_LIMIT = 2000;
const RETENTION_MS = 32 * 24 * 60 * 60 * 1000;
const PRUNE_EVERY_MS = 60 * 60 * 1000;

export const METRIC_PERIODS = {
    day: { span: 24 * 60 * 60 * 1000, step: METRIC_BUCKET_MS },
    week: { span: 7 * 24 * 60 * 60 * 1000, step: 60 * 60 * 1000 },
    month: { span: 30 * 24 * 60 * 60 * 1000, step: 6 * 60 * 60 * 1000 },
} as const;

export type MetricPeriod = keyof typeof METRIC_PERIODS;

export const isMetricPeriod = (value: unknown): value is MetricPeriod => typeof value === "string" && Object.hasOwn(METRIC_PERIODS, value);

export const bucketStart = (at: number) => Math.floor(at / METRIC_BUCKET_MS) * METRIC_BUCKET_MS;

export const median = (values: number[]) => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = sorted.length >> 1;
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export class ResponseTimeBucket {
    requests = 0;
    samples: number[] = [];

    constructor(
        public readonly start: number,
        private readonly random: () => number = Math.random,
    ) {}

    add(ms: number) {
        this.requests++;
        if (this.samples.length < SAMPLE_LIMIT) this.samples.push(ms);
        else {
            const slot = Math.floor(this.random() * this.requests);
            if (slot < SAMPLE_LIMIT) this.samples[slot] = ms;
        }
    }

    summary() {
        return { bucket_at: new Date(this.start), requests: this.requests, median_ms: Math.round(median(this.samples)) };
    }
}

type MetricRow = { bucket_at: Date; requests: number; median_ms: number };

export function aggregateMetrics(rows: MetricRow[], period: MetricPeriod, now: number) {
    const { span, step } = METRIC_PERIODS[period];
    const end = Math.floor(now / step) * step + step;
    const first = end - span;
    const slots = Array.from({ length: span / step }, () => ({ requests: 0, weighted: 0 }));
    let requests = 0;
    let weighted = 0;
    for (const row of rows) {
        const at = new Date(row.bucket_at).getTime();
        if (at < first || at >= end || row.requests <= 0) continue;
        const slot = slots[Math.floor((at - first) / step)];
        slot.requests += row.requests;
        slot.weighted += row.median_ms * row.requests;
        requests += row.requests;
        weighted += row.median_ms * row.requests;
    }
    return {
        period,
        interval_ms: step,
        average_ms: requests ? Math.round(weighted / requests) : null,
        points: slots.map((slot, i) => ({
            at: new Date(first + i * step).toISOString(),
            ms: slot.requests ? Math.round(slot.weighted / slot.requests) : null,
        })),
    };
}

const UNTIMED_PATHS = /^\/(status|science|metrics|track)(\/|$)/;

let current: ResponseTimeBucket | null = null;
let lastPrune = 0;

async function flush(bucket: ResponseTimeBucket) {
    if (!bucket.requests) return;
    try {
        await Object.assign(new StatusMetric(), bucket.summary()).save();
        if (Date.now() - lastPrune > PRUNE_EVERY_MS) {
            lastPrune = Date.now();
            await StatusMetric.delete({ bucket_at: LessThan(new Date(Date.now() - RETENTION_MS)) });
        }
    } catch (error) {
        console.warn("[Status] Could not save API response times:", (error as Error).message);
    }
}

function rotate(now: number) {
    const start = bucketStart(now);
    if (current?.start === start) return current;
    if (current) void flush(current);
    current = new ResponseTimeBucket(start);
    return current;
}

export function recordApiResponseTime(req: Request, res: Response, next: NextFunction) {
    if (req.method === "OPTIONS" || UNTIMED_PATHS.test(req.path)) return next();
    const started = performance.now();
    res.once("finish", () => rotate(Date.now()).add(performance.now() - started));
    next();
}

export function startStatusMetrics() {
    setInterval(() => rotate(Date.now()), 60 * 1000).unref();
}

export async function getStatusMetrics(period: MetricPeriod, now = Date.now()) {
    const { span, step } = METRIC_PERIODS[period];
    const end = Math.floor(now / step) * step + step;
    const rows = await StatusMetric.find({
        where: { bucket_at: Between(new Date(end - span), new Date(end)) },
        select: { bucket_at: true, requests: true, median_ms: true },
    });
    return aggregateMetrics(rows, period, now);
}
