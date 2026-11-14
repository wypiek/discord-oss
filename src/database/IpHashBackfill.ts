import type { DataSource, QueryRunner } from "typeorm";
import { hashIp, hashIpGroup, hashIpKey, ipFingerprint, ipHashSecret, redactAddress } from "../util/util/IpHash";
import { plainIp } from "../util/util/IpGroups";

type Executor = Pick<DataSource | QueryRunner, "query">;

const BATCH = 500;
const unhashed = (column: string) => `${column} IS NOT NULL AND substr(${column}, 1, 5) <> 'iph1_'`;

export const LEGACY_SPREAD_REASON = /^Used the banned address (.+), ban (\d+)$/;
export const LEGACY_CAP_TERM = /^(\d+ accounts?) on (.+), limit (\d+)$/;

export const spreadReasonFor = (fingerprint: string | null, banId: string) =>
    fingerprint ? `Used a banned address with fingerprint ${fingerprint}, ban ${banId}` : `Used a banned address, ban ${banId}`;
export const capTermFor = (accounts: string, fingerprint: string | null, max: string | number) =>
    `${accounts} from the network with fingerprint ${fingerprint ?? "unknown"}, limit ${max}`;

const groupHashFromKey = (key: string) => (plainIp(key) ? hashIpGroup(key) : /^[0-9a-f:]+\/64$/i.test(key) ? hashIpKey(key) : null);

async function rewrite<Row extends Record<string, unknown>>(db: Executor, select: string, update: (row: Row) => [string, unknown[]]) {
    let changed = 0;
    for (;;) {
        const rows: Row[] = await db.query(`${select} LIMIT ${BATCH}`);
        if (!rows.length) return changed;
        for (const row of rows) await db.query(...update(row));
        changed += rows.length;
        if (rows.length < BATCH) return changed;
    }
}

export async function backfillIpHashes(db: Executor) {
    const counts = {
        users: await rewrite<{ id: string; registration_ip: string }>(db, `SELECT "id", "registration_ip" FROM "users" WHERE ${unhashed('"registration_ip"')}`, (row) => [
            `UPDATE "users" SET "registration_ip" = $1, "registration_ip_group" = $2 WHERE "id" = $3`,
            [hashIp(row.registration_ip), hashIpGroup(row.registration_ip), row.id],
        ]),
        sessions: await rewrite<{ session_id: string; last_seen_ip: string }>(
            db,
            `SELECT "session_id", "last_seen_ip" FROM "sessions" WHERE ${unhashed('"last_seen_ip"')}`,
            (row) => [
                `UPDATE "sessions" SET "last_seen_ip" = $1, "last_seen_ip_group" = $2 WHERE "session_id" = $3`,
                [hashIp(row.last_seen_ip), hashIpGroup(row.last_seen_ip), row.session_id],
            ],
        ),
        bans: await rewrite<{ id: string; ip: string }>(db, `SELECT "id", "ip" FROM "bans" WHERE ${unhashed('"ip"')}`, (row) => [
            `UPDATE "bans" SET "ip" = $1 WHERE "id" = $2`,
            [hashIp(row.ip), row.id],
        ]),
        instance_bans: await rewrite<{ id: string; ip_address: string }>(db, `SELECT "id", "ip_address" FROM "instance_bans" WHERE ${unhashed('"ip_address"')}`, (row) => [
            `UPDATE "instance_bans" SET "ip_address" = $1 WHERE "id" = $2`,
            [hashIp(row.ip_address), row.id],
        ]),
        ban_reasons: await rewrite<{ id: string; reason: string }>(db, `SELECT "id", "reason" FROM "instance_bans" WHERE "reason" LIKE 'Used the banned address %'`, (row) => {
            const match = LEGACY_SPREAD_REASON.exec(row.reason);
            const reason = match ? spreadReasonFor(ipFingerprint(hashIp(match[1])), match[2]) : "Used a banned address";
            return [`UPDATE "instance_bans" SET "reason" = $1 WHERE "id" = $2`, [reason, row.id]];
        }),
        automod_terms: await rewrite<{ id: string; term: string }>(
            db,
            `SELECT "id", "term" FROM "automod_actions" WHERE "rule" = 'ip_account_limit' AND "term" LIKE '% on %, limit %'`,
            (row) => {
                const match = LEGACY_CAP_TERM.exec(row.term);
                const term = match ? capTermFor(match[1], ipFingerprint(groupHashFromKey(match[2])), match[3]) : null;
                return [`UPDATE "automod_actions" SET "term" = $1 WHERE "id" = $2`, [term, row.id]];
            },
        ),
        rate_limits: await purgeAddressRateLimits(db),
        audit_logs: await redactAuditChanges(db),
    };
    return counts;
}

const redactChange = (value: unknown) => (Array.isArray(value) ? value.map(redactAddress) : redactAddress(value));

async function redactAuditChanges(db: Executor) {
    let changed = 0;
    let after = "0";
    for (;;) {
        const rows: { id: string | number; changes: unknown }[] = await db.query(
            `SELECT "id", "changes" FROM "audit_logs" WHERE "action_type" >= 2000 AND "action_type" < 3000 AND "id" > $1 ORDER BY "id" LIMIT ${BATCH}`,
            [after],
        );
        for (const row of rows) {
            const parsed = typeof row.changes === "string" ? JSON.parse(row.changes) : row.changes;
            if (!Array.isArray(parsed)) continue;
            const redacted = parsed.map((change) =>
                change && typeof change === "object"
                    ? {
                          ...change,
                          ...("new_value" in change ? { new_value: redactChange(change.new_value) } : {}),
                          ...("old_value" in change ? { old_value: redactChange(change.old_value) } : {}),
                      }
                    : change,
            );
            const text = JSON.stringify(redacted);
            if (text === JSON.stringify(parsed)) continue;
            await db.query(`UPDATE "audit_logs" SET "changes" = $1 WHERE "id" = $2`, [text, row.id]);
            changed++;
        }
        if (rows.length < BATCH) return changed;
        after = String(rows.at(-1)!.id);
    }
}

async function purgeAddressRateLimits(db: Executor) {
    const condition = `"executor_id" LIKE '%.%' OR "executor_id" LIKE '%:%'
        OR ("id" LIKE 'automod-login:%' AND ("id" LIKE '%.%' OR "id" LIKE 'automod-login:%:%:%'))
        OR ("id" LIKE 'cap-request:%' AND "id" NOT LIKE 'cap-request:%:iph1%')`;
    const [{ count }]: { count: string | number }[] = await db.query(`SELECT COUNT(*) AS count FROM "rate_limits" WHERE ${condition}`);
    if (Number(count)) await db.query(`DELETE FROM "rate_limits" WHERE ${condition}`);
    return Number(count);
}

export async function runIpHashBackfill(db: Executor) {
    ipHashSecret();
    const counts = await backfillIpHashes(db);
    const changed = Object.entries(counts).filter(([, count]) => count > 0);
    if (changed.length) console.log(`[Database] Replaced stored IP addresses with hashes: ${changed.map(([table, count]) => `${table} ${count}`).join(", ")}`);
    return counts;
}
