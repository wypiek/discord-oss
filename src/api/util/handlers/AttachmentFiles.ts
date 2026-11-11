import { isSqlite, sqlNow } from "@spacebar/database/Sql";
import { withJobLease } from "@spacebar/database/JobLease";
import { ProcessLifecycle } from "../../../util/util/ProcessLifecycle";
import { getDatabase } from "@spacebar/database";
import { deleteFile, trackBackground } from "@spacebar/util";

const BATCH = 200;
const GRACE_SECONDS = 30;
let stopping = false;
let workerTimer: NodeJS.Timeout | undefined;
let running: Promise<void> | null = null;

type QueuedFile = { attachment_id: string; channel_id: string; message_id: string | null; filename: string };

const graceCutoff = () => (isSqlite() ? `strftime('%Y-%m-%d %H:%M:%f', 'now', '-${GRACE_SECONDS} seconds')` : `now() - interval '${GRACE_SECONDS} seconds'`);

async function sweep(until: number) {
    await withJobLease("attachment-files", async () => {
        while (!stopping && Date.now() < until && (await sweepBatch(until)) >= BATCH) await new Promise<void>((resolve) => void setImmediate(resolve));
    });
}

async function sweepBatch(until: number) {
    const db = getDatabase()!;
    const queued = (await db.query(
        `SELECT CAST("attachment_id" AS text) AS attachment_id, CAST("channel_id" AS text) AS channel_id, CAST("message_id" AS text) AS message_id, "filename"
        FROM "attachment_file_deletes" WHERE "created_at" <= ${graceCutoff()} ORDER BY "created_at", "attachment_id" LIMIT ${BATCH}`,
    )) as QueuedFile[];
    for (const file of queued) {
        if (stopping || Date.now() >= until) return 0;
        try {
            const [referenced] = await db.query(
                `SELECT 1 AS referenced FROM "attachments" WHERE "id" = $1 UNION ALL SELECT 1 FROM "attachment_holds" WHERE "attachment_id" = $1 LIMIT 1`,
                [file.attachment_id],
            );
            if (!referenced) {
                await deleteFile(`/attachments/${file.channel_id}/${file.attachment_id}/${encodeURIComponent(file.filename)}`);
                const [legacyReferenced] = file.message_id
                    ? await db.query(
                          `SELECT 1 AS referenced FROM "attachments" WHERE "channel_id" = $1 AND "message_id" = $2 AND "filename" = $3
                          UNION ALL SELECT 1 FROM "attachment_holds" WHERE "channel_id" = $1 AND "message_id" = $2 AND "filename" = $3 LIMIT 1`,
                          [file.channel_id, file.message_id, file.filename],
                      )
                    : [true];
                if (!legacyReferenced) await deleteFile(`/attachments/${file.channel_id}/${file.message_id}/${encodeURIComponent(file.filename)}`);
            }
            await db.query(`DELETE FROM "attachment_file_deletes" WHERE "attachment_id" = $1`, [file.attachment_id]);
        } catch (error) {
            console.error(`[AttachmentFiles] couldn't delete the file of attachment ${file.attachment_id}`, error);
            await db.query(`UPDATE "attachment_file_deletes" SET "created_at" = ${sqlNow()} WHERE "attachment_id" = $1`, [file.attachment_id]).catch(() => undefined);
        }
    }
    return queued.length;
}

export function sweepAttachmentFiles(until = Infinity) {
    if (stopping) return running ?? Promise.resolve();
    if (running) return running;
    running = sweep(until)
        .catch((error) => console.error("[AttachmentFiles] failed to sweep deleted attachment files", error))
        .finally(() => {
            running = null;
        });
    return trackBackground(running);
}

export function startAttachmentFileSweeper() {
    if (workerTimer || stopping) return workerTimer;
    const initial = setTimeout(() => sweepAttachmentFiles(), 10_000);
    workerTimer = setInterval(() => sweepAttachmentFiles(), GRACE_SECONDS * 1000);
    ProcessLifecycle.eventEmitter.once("stopping", async () => {
        stopping = true;
        clearTimeout(initial);
        clearInterval(workerTimer);
        await Promise.allSettled(running ? [running] : []);
    });
    return workerTimer;
}
