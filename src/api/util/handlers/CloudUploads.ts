import { ProcessLifecycle } from "../../../util/util/ProcessLifecycle";
import { getDatabase } from "@spacebar/database";
import { withJobLease } from "@spacebar/database/JobLease";
import { deleteFile, trackBackground } from "@spacebar/util";

export const CLOUD_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
const BATCH = 100;
const SNOWFLAKE_EPOCH = 1420070400000;
let stopping = false;
let workerTimer: NodeJS.Timeout | undefined;
let running: Promise<void> | null = null;

type ExpiredUpload = { id: string; user_id: string | null; upload_filename: string };

async function sweepBatch(now: number, after: string, until: number) {
    const db = getDatabase()!;
    const cutoff = (BigInt(Math.max(0, now - CLOUD_UPLOAD_TTL_MS - SNOWFLAKE_EPOCH)) << 22n).toString();
    const expired = (await db.query(
        `SELECT CAST("id" AS text) AS id, CAST("user_id" AS text) AS user_id, "upload_filename" FROM "cloud_attachments" WHERE CAST("id" AS bigint) < CAST($1 AS bigint) AND CAST("id" AS bigint) > CAST($2 AS bigint)
        ORDER BY CAST("id" AS bigint) LIMIT ${BATCH}`,
        [cutoff, after],
    )) as ExpiredUpload[];
    const owners = [...new Set(expired.flatMap((upload) => (upload.user_id ? [upload.user_id] : [])))];
    const scheduled = owners.length
        ? ((await db.query(
              `SELECT CAST("user_id" AS text) AS user_id, "payload" FROM "scheduled_messages" WHERE "state" = 0 AND "user_id" IN (${owners.map((_, index) => `$${index + 1}`).join(", ")})`,
              owners,
          )) as {
              user_id: string;
              payload: unknown;
          }[])
        : [];
    const held = new Set(
        scheduled.flatMap(({ user_id, payload }) => {
            const parsed = (typeof payload === "string" ? JSON.parse(payload) : payload) as { attachments?: { uploaded_filename?: unknown }[] } | null;
            return (parsed?.attachments ?? []).flatMap((attachment) => (typeof attachment?.uploaded_filename === "string" ? [`${user_id}:${attachment.uploaded_filename}`] : []));
        }),
    );
    for (const upload of expired) {
        if (stopping || Date.now() >= until) break;
        if (held.has(`${upload.user_id}:${upload.upload_filename}`)) continue;
        try {
            await deleteFile(`/attachments/${upload.upload_filename.split("/").map(encodeURIComponent).join("/")}`);
        } catch (error) {
            const [remaining] = await db.query(`SELECT 1 AS remaining FROM "cloud_attachments" WHERE "id" = $1`, [upload.id]);
            if (!remaining) continue;
            console.error(`[CloudUploads] couldn't delete expired upload ${upload.id}`, error);
        }
    }
    return { scanned: expired.length, last: expired.at(-1)?.id ?? after };
}

async function sweep(now: number, until: number) {
    await withJobLease("cloud-uploads", async () => {
        let after = "0";
        while (!stopping && Date.now() < until) {
            const { scanned, last } = await sweepBatch(now, after, until);
            if (scanned < BATCH) return;
            after = last;
            await new Promise<void>((resolve) => void setImmediate(resolve));
        }
    });
}

export function sweepExpiredCloudUploads(now = Date.now(), until = Infinity) {
    if (stopping) return running ?? Promise.resolve();
    if (running) return running;
    running = sweep(now, until)
        .catch((error) => console.error("[CloudUploads] failed to sweep expired uploads", error))
        .finally(() => {
            running = null;
        });
    return trackBackground(running);
}

export function startCloudUploadSweeper() {
    if (workerTimer || stopping) return workerTimer;
    const initial = setTimeout(() => sweepExpiredCloudUploads(), 15_000);
    workerTimer = setInterval(() => sweepExpiredCloudUploads(), 5 * 60 * 1000);
    ProcessLifecycle.eventEmitter.once("stopping", async () => {
        stopping = true;
        clearTimeout(initial);
        clearInterval(workerTimer);
        await Promise.allSettled(running ? [running] : []);
    });
    return workerTimer;
}
