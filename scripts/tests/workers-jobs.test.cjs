const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./helpers/route-harness.cjs");

function workerJobs() {
    const calls = [];
    const record =
        (name) =>
        async (...args) => {
            calls.push([name, ...args]);
        };
    const runner = {
        connect: async () => undefined,
        startTransaction: async () => undefined,
        query: async () => [{ locked: true }],
        commitTransaction: async () => undefined,
        rollbackTransaction: async () => undefined,
        release: async () => undefined,
    };
    const { runJobs } = loadModule("workers/api/src/jobs.ts", {
        "@spacebar/util": { Config: { get: () => ({ federation: { enabled: false } }) }, FederationKey: { ready: false } },
        "@spacebar/api/util": {
            sendDueScheduledMessages: record("scheduled-messages"),
            finalizeExpiredPolls: record("poll-expiry"),
            archiveInactiveThreads: record("thread-archiver"),
            purgeDeletedChannels: record("message-purge"),
        },
        "@spacebar/database": {
            getDatabase: () => ({ createQueryRunner: () => runner }),
            ScheduledEvents: { sweep: record("scheduled-events") },
            GuildInsights: { rollupPending: record("insight-rollups") },
        },
        "@spacebar/api/middlewares/RateLimit": { pruneRateLimits: record("rate-limit-prune") },
        "@spacebar/api/util/handlers/Instance": { pruneTemporarySessions: record("temporary-sessions") },
        "@spacebar/api/util/handlers/Discovery": { reindexDiscovery: record("discovery-index") },
        "@spacebar/api/util/utility/announcementDelivery": { runAnnouncementDeliveries: record("announcement-delivery") },
        "@spacebar/api/util/utility/federation": { runFederationCycle: record("federation-registry") },
        "@spacebar/api/util/utility/federationEvents": {},
        "@spacebar/api/util/handlers/AttachmentFiles": { sweepAttachmentFiles: record("attachment-files") },
        "@spacebar/api/util/handlers/ImageFiles": { sweepImageFiles: record("image-files") },
        "@spacebar/api/util/handlers/CloudUploads": { sweepExpiredCloudUploads: record("cloud-uploads") },
    });
    return { calls, runJobs };
}

test("the Workers cron sweeps deleted attachment files, replaced images and expired upload slots within its time slice", async () => {
    const { calls, runJobs } = workerJobs();
    const log = console.log;
    console.log = () => undefined;
    const started = Date.now();
    try {
        await runJobs({ JOBS_BUDGET_MS: "25000" }, "all", started);
    } finally {
        console.log = log;
    }
    const call = (name) => calls.find(([job]) => job === name);
    const [, attachmentUntil] = call("attachment-files");
    const [, imageUntil] = call("image-files");
    const [, now, cloudUntil] = call("cloud-uploads");
    for (const until of [attachmentUntil, imageUntil, cloudUntil]) {
        assert.equal(typeof until, "number");
        assert.ok(until > started && until <= started + 25_000);
    }
    assert.ok(now >= started && now <= Date.now());
});

test("the Workers cron sweeps upload slots every 5 minutes and the other file queues every minute", async () => {
    const { calls, runJobs } = workerJobs();
    const log = console.log;
    console.log = () => undefined;
    try {
        await runJobs({}, "* * * * *", 7 * 60_000);
    } finally {
        console.log = log;
    }
    const ran = calls.map(([job]) => job);
    assert.ok(ran.includes("attachment-files"));
    assert.ok(ran.includes("image-files"));
    assert.ok(!ran.includes("cloud-uploads"));
});
