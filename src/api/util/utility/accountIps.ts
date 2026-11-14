import { isIP } from "node:net";
import { In } from "typeorm";
import { HTTPError } from "lambert-server/HTTPError";
import { getDatabase, InstanceBan } from "@spacebar/database";
import { hashIp, ipFingerprint } from "@spacebar/util/util/IpHash";

const MAPPED_V4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

export const normalizeIp = (value: string | undefined | null) => {
    const ip = value?.trim();
    if (!ip) return null;
    return MAPPED_V4.exec(ip)?.[1] ?? ip;
};

export const parseIp = (value: unknown) => {
    if (typeof value !== "string") return null;
    const ip = normalizeIp(value);
    return ip && isIP(ip) ? ip : null;
};

export const addressQuery = (value: unknown) => (typeof value === "string" ? hashIp(value.trim()) : null);

export const isIpBanned = async (value: string | undefined | null) => {
    const hash = value && !InstanceBan.sharedAddress(value) ? hashIp(value) : null;
    if (!hash) return false;
    const bans = await InstanceBan.find({ where: { ip_address: hash, is_allowlisted: false } });
    return bans.some((ban) => InstanceBan.live(ban));
};

export const assertIpNotBanned = async (value: string | undefined | null, message: string) => {
    if (await isIpBanned(value)) throw new HTTPError(message, 403);
};

const seenIps = () => `SELECT "registration_ip" AS ip, "id" AS user_id, "created_at" AS seen_at, 1 AS registered FROM "users" WHERE "registration_ip" IS NOT NULL
    UNION ALL
    SELECT "last_seen_ip" AS ip, "user_id", COALESCE("last_seen", "created_at") AS seen_at, 0 AS registered FROM "sessions" WHERE "last_seen_ip" IS NOT NULL`;

export async function ipBansFor(hashes: string[]) {
    const unique = [...new Set(hashes)];
    const bans = unique.length ? await InstanceBan.find({ where: { ip_address: In(unique), is_allowlisted: false }, select: { id: true, ip_address: true } }) : [];
    return new Map(bans.map((ban) => [ban.ip_address!, ban.id]));
}

export async function listIps(opts: { ips?: string[]; limit: number; offset: number }) {
    const database = getDatabase();
    if (!database) throw new HTTPError("Database unavailable", 503);
    if (opts.ips && !opts.ips.length) return { total: 0, ips: [] };
    const params: string[] = [];
    const placeholder = (value: string) => `$${params.push(value)}`;
    const filter = opts.ips ? `WHERE ip IN (${opts.ips.map(placeholder).join(", ")})` : "";
    const [counted]: { total: string | number }[] = await database.query(`WITH seen AS (${seenIps()}) SELECT COUNT(DISTINCT ip) AS total FROM seen ${filter}`, params);
    const rows: { ip: string; accounts: string | number; registrations: string | number; last_seen: Date | string | null }[] = await database.query(
        `WITH seen AS (${seenIps()})
        SELECT ip, COUNT(DISTINCT user_id) AS accounts, COUNT(DISTINCT CASE WHEN registered = 1 THEN user_id END) AS registrations, MAX(seen_at) AS last_seen
        FROM seen ${filter}
        GROUP BY ip
        ORDER BY accounts DESC, last_seen DESC, ip
        LIMIT ${Math.trunc(opts.limit)} OFFSET ${Math.trunc(opts.offset)}`,
        params,
    );
    const bans = await ipBansFor(rows.map((row) => row.ip));
    return {
        total: Number(counted?.total ?? 0),
        ips: rows.map((row) => ({
            ip: row.ip,
            fingerprint: ipFingerprint(row.ip),
            accounts: Number(row.accounts),
            registrations: Number(row.registrations),
            last_seen: row.last_seen ? new Date(row.last_seen).toISOString() : null,
            ban_id: bans.get(row.ip) ?? null,
        })),
    };
}
