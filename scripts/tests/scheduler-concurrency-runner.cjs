const { mock } = require("node:test");

const report = (kind, value) => process.stdout.write(`${JSON.stringify({ kind, value })}\n`);

const jobs = {
    "scheduled-events": () => require("../../dist/database").ScheduledEvents.sweep(),
    "image-files": () => require("../../dist/api/util/handlers/ImageFiles").sweepImageFiles(),
    "attachment-files": () => require("../../dist/api/util/handlers/AttachmentFiles").sweepAttachmentFiles(),
    "cloud-uploads": () => require("../../dist/api/util/handlers/CloudUploads").sweepExpiredCloudUploads(),
    "scheduled-messages": () => require("../../dist/api/util/handlers/ScheduledMessages").sendDueScheduledMessages(),
    "poll-expiry": () => require("../../dist/api/util/utility/polls").finalizeExpiredPolls(),
    "message-purge": () => require("../../dist/api/util/handlers/MessagePurge").purgeDeletedChannels(),
    "temporary-sessions": () => require("../../dist/api/util/handlers/Instance").pruneTemporarySessions(),
    "discovery-index": () => require("../../dist/api/util/handlers/Discovery").reindexDiscovery(),
    "discovery-index-interval": () => require("../../dist/api/util/handlers/Discovery").runDiscoveryIndex(),
    "harvest-request": async () => {
        const { createHarvest } = require("../../dist/api/util/utility/harvest");
        const created = await createHarvest(process.env.SCHEDULER_USER, ["Zendesk"]);
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return created ? created.harvest_id : "refused";
    },
};

(async () => {
    const job = jobs[process.env.SCHEDULER_JOB];
    if (!job) throw new Error(`Unknown job ${process.env.SCHEDULER_JOB}`);
    const database = require("../../dist/database");
    const db = await database.initDatabase();
    const { ConfigValue } = require("../../dist/util/config");
    const config = new ConfigValue();
    config.cdn.endpointPrivate = process.env.SCHEDULER_CDN_URL;
    config.security.requestSignature = "scheduler-concurrency-test";
    config.guild.discovery.showAllGuilds = true;
    mock.method(require("../../dist/util/util/Config").Config, "get", () => config);
    mock.method(require("../../dist/util/util/ipc/Event"), "emitEvent", async (event) => report("event", { event: event.event, id: event.data?.id, status: event.data?.status }));
    mock.method(require("../../dist/api/util/handlers/UserMessage"), "publishUserMessage", async ({ message_id, channel }) =>
        report("send", { message_id, channel_id: channel.id }),
    );
    mock.method(require("../../dist/api/util/handlers/Message"), "sendMessage", async (options) => report("send", { reference: options.message_reference?.message_id }));
    const start = Number(process.env.SCHEDULER_START_AT);
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, start - Date.now())));
    const value = await job();
    report("done", value ?? null);
    await db.destroy();
    process.exit(0);
})().catch((error) => {
    report("error", String(error?.stack ?? error));
    process.exit(1);
});
