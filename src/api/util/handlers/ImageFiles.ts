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

const graceCutoff = () => (isSqlite() ? `strftime('%Y-%m-%d %H:%M:%f', 'now', '-${GRACE_SECONDS} seconds')` : `now() - interval '${GRACE_SECONDS} seconds'`);
const json = (column: string, path: string[]) =>
    isSqlite() ? `CASE WHEN json_valid(${column}) THEN json_extract(${column}, '$.${path.join(".")}') END` : `${column}#>>'{${path.join(",")}}'`;
const recentAvatar = () =>
    isSqlite()
        ? `SELECT 1 FROM "users" u, json_each(CASE WHEN json_valid(u."recent_avatars") AND json_type(u."recent_avatars") = 'array' THEN u."recent_avatars" ELSE '[]' END) entry
            WHERE u."id" = $1 AND entry.type = 'object' AND json_extract(entry.value, '$.storage_hash') = $2`
        : `SELECT 1 FROM "users" WHERE "id" = $1 AND jsonb_typeof("recent_avatars") = 'array' AND "recent_avatars" @> jsonb_build_array(jsonb_build_object('storage_hash', CAST($2 AS text)))`;
const columns = (table: string, ...names: string[]) => `SELECT 1 FROM "${table}" WHERE "id" = $1 AND $2 IN (${names.map((name) => `"${name}"`).join(", ")})`;

const ID = String.raw`(\d{1,19})`;
const HASH = String.raw`([\w-]{1,128})`;
const REFERENCES: [RegExp, () => string[]][] = [
    [
        new RegExp(`^avatars/${ID}/${HASH}$`),
        () => [
            columns("users", "avatar"),
            recentAvatar(),
            columns("webhooks", "avatar"),
            `SELECT 1 FROM "messages" WHERE "author_id" = $1 AND "avatar" = $2`,
            `SELECT 1 FROM "reports" WHERE ${json(`"snapshot"`, ["author", "id"])} = CAST($1 AS text) AND ${json(`"snapshot"`, ["author", "avatar"])} = $2`,
        ],
    ],
    [new RegExp(`^banners/${ID}/${HASH}$`), () => [columns("users", "banner"), columns("guilds", "banner")]],
    [new RegExp(`^icons/${ID}/${HASH}$`), () => [columns("guilds", "icon")]],
    [new RegExp(`^splashes/${ID}/${HASH}$`), () => [columns("guilds", "splash")]],
    [new RegExp(`^discovery-splashes/${ID}/${HASH}$`), () => [columns("guilds", "discovery_splash")]],
    [new RegExp(`^guild-space/${ID}/banner/${HASH}$`), () => [`SELECT 1 FROM "guilds" WHERE "id" = $1 AND ${json(`"profile"`, ["custom_banner_hash"])} = $2`]],
    [new RegExp(`^channel-icons/${ID}/${HASH}$`), () => [columns("channels", "icon")]],
    [new RegExp(`^role-icons/${ID}/${HASH}\\.png$`), () => [columns("roles", "icon")]],
    [new RegExp(`^app-icons/${ID}/${HASH}$`), () => [columns("applications", "icon", "cover_image"), columns("custom_games", "icon_hash", "cover_image_hash")]],
    [new RegExp(`^guild-events/${ID}/${HASH}$`), () => [columns("guild_scheduled_events", "image")]],
    [new RegExp(`^guilds/${ID}/users/${ID}/avatars/${HASH}$`), () => [`SELECT 1 FROM "members" WHERE "guild_id" = $1 AND "id" = $2 AND $3 IN ("avatar", "banner")`]],
];

async function referenced(path: string) {
    const db = getDatabase()!;
    for (const [pattern, queries] of REFERENCES) {
        const match = pattern.exec(path);
        if (!match) continue;
        for (const sql of queries()) if ((await db.query(`${sql} LIMIT 1`, match.slice(1))).length) return true;
        return false;
    }
    return null;
}

async function sweep(until: number) {
    await withJobLease("image-files", async () => {
        while (!stopping && Date.now() < until && (await sweepBatch(until)) >= BATCH) await new Promise<void>((resolve) => void setImmediate(resolve));
    });
}

async function sweepBatch(until: number) {
    const db = getDatabase()!;
    const queued = (await db.query(`SELECT "path" FROM "image_file_deletes" WHERE "created_at" <= ${graceCutoff()} ORDER BY "created_at", "path" LIMIT ${BATCH}`)) as {
        path: string;
    }[];
    for (const { path } of queued) {
        if (stopping || Date.now() >= until) return 0;
        try {
            if ((await referenced(path)) === false) await deleteFile(`/${path.split("/").map(encodeURIComponent).join("/")}`);
            await db.query(`DELETE FROM "image_file_deletes" WHERE "path" = $1`, [path]);
        } catch (error) {
            console.error(`[ImageFiles] couldn't delete ${path}`, error);
            await db.query(`UPDATE "image_file_deletes" SET "created_at" = ${sqlNow()} WHERE "path" = $1`, [path]).catch(() => undefined);
        }
    }
    return queued.length;
}

export function sweepImageFiles(until = Infinity) {
    if (stopping) return running ?? Promise.resolve();
    if (running) return running;
    running = sweep(until)
        .catch((error) => console.error("[ImageFiles] failed to sweep replaced images", error))
        .finally(() => {
            running = null;
        });
    return trackBackground(running);
}

export function startImageFileSweeper() {
    if (workerTimer || stopping) return workerTimer;
    const initial = setTimeout(() => sweepImageFiles(), 10_000);
    workerTimer = setInterval(() => sweepImageFiles(), GRACE_SECONDS * 1000);
    ProcessLifecycle.eventEmitter.once("stopping", async () => {
        stopping = true;
        clearTimeout(initial);
        clearInterval(workerTimer);
        await Promise.allSettled(running ? [running] : []);
    });
    return workerTimer;
}
