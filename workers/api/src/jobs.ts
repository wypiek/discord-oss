export interface JobContext {
    until: number;
}

export interface Job {
    name: string;
    everyMinutes: number;
    slice: number;
    run: (context: JobContext) => Promise<unknown>;
}

export interface JobResult {
    name: string;
    outcome: "ran" | "skipped" | "busy" | "failed";
    ms: number;
    detail?: unknown;
}

const loadJobs = async (): Promise<Job[]> => {
    const [util, apiUtil, database, rateLimits, instance, discovery, announcements, federation, federationEvents, attachmentFiles, imageFiles, cloudUploads] = await Promise.all([
        import("@spacebar/util"),
        import("@spacebar/api/util"),
        import("@spacebar/database"),
        import("@spacebar/api/middlewares/RateLimit"),
        import("@spacebar/api/util/handlers/Instance"),
        import("@spacebar/api/util/handlers/Discovery"),
        import("@spacebar/api/util/utility/announcementDelivery"),
        import("@spacebar/api/util/utility/federation"),
        import("@spacebar/api/util/utility/federationEvents"),
        import("@spacebar/api/util/handlers/AttachmentFiles"),
        import("@spacebar/api/util/handlers/ImageFiles"),
        import("@spacebar/api/util/handlers/CloudUploads"),
    ]);
    const federating = () => util.Config.get().federation.enabled && util.FederationKey.ready;
    return [
        { name: "scheduled-messages", everyMinutes: 1, slice: 10_000, run: ({ until }) => apiUtil.sendDueScheduledMessages(until) },
        { name: "scheduled-events", everyMinutes: 1, slice: 5_000, run: () => database.ScheduledEvents.sweep() },
        { name: "poll-expiry", everyMinutes: 1, slice: 5_000, run: ({ until }) => apiUtil.finalizeExpiredPolls(until) },
        { name: "announcement-delivery", everyMinutes: 1, slice: 10_000, run: () => announcements.runAnnouncementDeliveries() },
        { name: "thread-archiver", everyMinutes: 1, slice: 10_000, run: ({ until }) => apiUtil.archiveInactiveThreads(until) },
        { name: "message-purge", everyMinutes: 1, slice: 10_000, run: ({ until }) => apiUtil.purgeDeletedChannels(until) },
        { name: "rate-limit-prune", everyMinutes: 1, slice: 5_000, run: () => rateLimits.pruneRateLimits() },
        { name: "attachment-files", everyMinutes: 1, slice: 10_000, run: ({ until }) => attachmentFiles.sweepAttachmentFiles(until) },
        { name: "image-files", everyMinutes: 1, slice: 10_000, run: ({ until }) => imageFiles.sweepImageFiles(until) },
        {
            name: "federation-delivery",
            everyMinutes: 1,
            slice: 10_000,
            run: async ({ until }) => (federating() ? federationEvents.deliverQueuedEvents(until) : "federation is off or has no key"),
        },
        { name: "temporary-sessions", everyMinutes: 5, slice: 5_000, run: () => instance.pruneTemporarySessions() },
        { name: "cloud-uploads", everyMinutes: 5, slice: 10_000, run: ({ until }) => cloudUploads.sweepExpiredCloudUploads(Date.now(), until) },
        { name: "federation-registry", everyMinutes: 5, slice: 20_000, run: async () => (federating() ? federation.runFederationCycle() : "federation is off or has no key") },
        { name: "discovery-index", everyMinutes: 10, slice: 15_000, run: ({ until }) => discovery.reindexDiscovery(until) },
        { name: "federation-presence", everyMinutes: 10, slice: 10_000, run: async () => (federating() ? federationEvents.refreshPresences() : "federation is off or has no key") },
        {
            name: "federation-inbox-prune",
            everyMinutes: 60,
            slice: 5_000,
            run: async () => (federating() ? federationEvents.pruneReceivedEvents() : "federation is off or has no key"),
        },
        { name: "insight-rollups", everyMinutes: 60, slice: 60_000, run: () => database.GuildInsights.rollupPending() },
    ];
};

let jobs: Promise<Job[]> | undefined;

const withJobLock = async <T>(name: string, work: () => Promise<T>): Promise<{ locked: false } | { locked: true; value: T }> => {
    const { getDatabase } = await import("@spacebar/database");
    const runner = getDatabase()!.createQueryRunner();
    await runner.connect();
    try {
        await runner.startTransaction();
        const [{ locked }] = (await runner.query("SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked", [`meowcord-job:${name}`])) as { locked: boolean }[];
        if (!locked) {
            await runner.rollbackTransaction();
            return { locked: false };
        }
        try {
            return { locked: true, value: await work() };
        } finally {
            await runner.commitTransaction().catch(() => runner.rollbackTransaction());
        }
    } finally {
        await runner.release();
    }
};

export const runJobs = async (env: { JOBS_BUDGET_MS?: string }, cron: string, scheduledTime: number) => {
    jobs ??= loadJobs().catch((error) => {
        jobs = undefined;
        throw error;
    });
    const started = Date.now();
    const deadline = started + (Number(env.JOBS_BUDGET_MS) || 25_000);
    const minute = Math.floor(scheduledTime / 60_000);
    const results: JobResult[] = [];
    for (const job of await jobs) {
        const begin = Date.now();
        const due = cron === "all" || minute % job.everyMinutes === 0;
        if (!due || begin >= deadline) {
            results.push({ name: job.name, outcome: "skipped", ms: 0 });
            continue;
        }
        const until = Math.min(deadline, begin + job.slice);
        try {
            const result = await withJobLock(job.name, () => job.run({ until }));
            results.push({
                name: job.name,
                outcome: result.locked ? "ran" : "busy",
                ms: Date.now() - begin,
                ...(result.locked && result.value !== undefined && { detail: result.value }),
            });
        } catch (error) {
            console.error(`[Jobs] ${job.name} failed`, error);
            results.push({ name: job.name, outcome: "failed", ms: Date.now() - begin, detail: (error as Error).message });
        }
    }
    console.log(
        `[Jobs] ${cron} took ${Date.now() - started} ms: ${results.map(({ name, outcome, ms }) => `${name} ${outcome}${outcome === "skipped" ? "" : ` ${ms}ms`}`).join(", ")}`,
    );
    return results;
};
