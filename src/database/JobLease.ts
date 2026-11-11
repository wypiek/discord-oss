import { randomUUID } from "node:crypto";
import { getDatabase } from "./Database";
import { sqlReturning } from "./Sql";

export const JOB_LEASE_MS = 60_000;

export type JobLeaseResult<T> = { held: false } | { held: true; value: T };

export async function claimJobLease(name: string, untilMs: number, holder: string = randomUUID()) {
    const rows = (await getDatabase()!.query(
        sqlReturning(`INSERT INTO "job_leases" ("name", "holder", "expires_at") VALUES ($1, $2, $3)
        ON CONFLICT ("name") DO UPDATE SET "holder" = excluded."holder", "expires_at" = excluded."expires_at" WHERE "job_leases"."expires_at" <= $4 RETURNING "holder"`),
        [name, holder, untilMs, Date.now()],
    )) as { holder: string }[];
    return rows.length ? holder : null;
}

export async function withJobLease<T>(name: string, work: () => Promise<T>, holdForMs = 0): Promise<JobLeaseResult<T>> {
    const started = Date.now();
    const holder = await claimJobLease(name, Math.max(started + JOB_LEASE_MS, started + holdForMs));
    if (!holder) return { held: false };
    const database = getDatabase()!;
    let renewing: Promise<unknown> | undefined;
    const heartbeat = setInterval(() => {
        if (renewing) return;
        renewing = database
            .query(`UPDATE "job_leases" SET "expires_at" = $3 WHERE "name" = $1 AND "holder" = $2`, [name, holder, Math.max(Date.now() + JOB_LEASE_MS, started + holdForMs)])
            .catch((error) => console.error(`[Jobs] couldn't renew the lease of ${name}`, error))
            .finally(() => {
                renewing = undefined;
            });
    }, JOB_LEASE_MS / 3).unref();
    try {
        return { held: true, value: await work() };
    } finally {
        clearInterval(heartbeat);
        await renewing;
        const release =
            started + holdForMs > Date.now()
                ? database.query(`UPDATE "job_leases" SET "expires_at" = $3 WHERE "name" = $1 AND "holder" = $2`, [name, holder, started + holdForMs])
                : database.query(`DELETE FROM "job_leases" WHERE "name" = $1 AND "holder" = $2`, [name, holder]);
        await release.catch((error) => console.error(`[Jobs] couldn't release the lease of ${name}`, error));
    }
}

export async function pauseJob(name: string, untilMs: number) {
    await getDatabase()!.query(
        `INSERT INTO "job_leases" ("name", "holder", "expires_at") VALUES ($1, 'paused', $2) ON CONFLICT ("name") DO UPDATE SET "holder" = 'paused', "expires_at" = excluded."expires_at"`,
        [name, untilMs],
    );
}

export async function resumeJob(name: string) {
    await getDatabase()!.query(`DELETE FROM "job_leases" WHERE "name" = $1 AND "holder" = 'paused'`, [name]);
}
