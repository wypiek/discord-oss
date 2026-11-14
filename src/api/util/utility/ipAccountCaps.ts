import { In, MoreThan } from "typeorm";
import { capTermFor, Session, User } from "@spacebar/database";
import { Config, FieldErrors, isCloudflareAddress, isPrivateAddress, isStaffAccount, loadStaffRoles } from "@spacebar/util";
import { IpGroup, ipGroup, ipRangeMatcher } from "@spacebar/util/util/IpGroups";
import { hashIpKey, ipFingerprint } from "@spacebar/util/util/IpHash";
import { recordAutomodAction } from "./instanceAutomod";
import { logRestrictionOnce } from "./spamGuard";
import { exemptionFrom, rulePolicy } from "./automodPolicy";

const DAY = 24 * 60 * 60 * 1000;
const CANDIDATE_LIMIT = 5000;

let allowCache: { source: string; matches: (ip: unknown) => boolean } | null = null;

export function isIpCapExempt(ip: unknown) {
    if (typeof ip === "string" && (isPrivateAddress(ip) || isCloudflareAddress(ip))) return true;
    const list = Config.get().automod.ipAllowList ?? [];
    const source = list.join("\n");
    if (allowCache?.source !== source) allowCache = { source, matches: ipRangeMatcher(list) };
    return allowCache.matches(ip);
}

export const groupHash = (group: IpGroup) => hashIpKey(group.key);

export async function accountsRegisteredFrom(group: IpGroup) {
    const users = await User.find({
        where: { registration_ip_group: groupHash(group), deleted: false, disabled: false },
        select: { id: true, rights: true },
        take: CANDIDATE_LIMIT,
    });
    const snap = await loadStaffRoles();
    return users.filter((user) => !isStaffAccount(user, snap)).map((user) => user.id);
}

export async function accountsSignedInFrom(group: IpGroup, activeDays: number) {
    const since = new Date(Date.now() - Math.max(1, activeDays) * DAY);
    const hash = groupHash(group);
    const sessions = await Session.find({
        where: [
            { last_seen_ip_group: hash, last_seen: MoreThan(since) },
            { last_seen_ip_group: hash, created_at: MoreThan(since) },
        ],
        select: { session_id: true, user_id: true },
        take: CANDIDATE_LIMIT,
    });
    const ids = [...new Set(sessions.map((session) => session.user_id))];
    if (!ids.length) return [];
    const users = await User.find({ where: { id: In(ids), deleted: false, disabled: false }, select: { id: true, rights: true } });
    const snap = await loadStaffRoles();
    return users.filter((user) => !isStaffAccount(user, snap)).map((user) => user.id);
}

async function logRefusal(kind: "registration" | "login", group: IpGroup, count: number, max: number, user?: { id?: string; username?: string | null }) {
    const dryRun = rulePolicy("ipAccountLimit").dryRun;
    const hash = groupHash(group);
    if (!logRestrictionOnce(`ip-cap:${kind}:${hash}:${user?.id ?? user?.username ?? ""}`, 10 * 60 * 1000)) return dryRun;
    await recordAutomodAction({
        user_id: user?.id ?? null,
        username: user?.username?.slice(0, 64) ?? null,
        rule: "ip_account_limit",
        term: capTermFor(`${count} account${count === 1 ? "" : "s"}`, ipFingerprint(hash), max),
        source: kind,
        action: dryRun ? "log" : "block",
        would_action: dryRun ? "block" : null,
    }).catch(() => undefined);
    return dryRun;
}

export async function assertRegistrationIpCap(ip: string | undefined, username?: string) {
    const max = Config.get().automod.registration.maxAccountsPerIp;
    if (!max || max < 1 || !rulePolicy("ipAccountLimit").enabled) return;
    const group = ipGroup(ip);
    if (!group || isIpCapExempt(group.ip)) return;
    const accounts = await accountsRegisteredFrom(group);
    if (accounts.length < max) return;
    if (await logRefusal("registration", group, accounts.length, max, { username })) return;
    const message = `This network already has ${max === 1 ? "an account" : `${max} accounts`} on this instance, which is the limit. Ask a moderator if you need another one.`;
    throw FieldErrors({ username: { code: "TOO_MANY_ACCOUNTS_ON_IP", message }, email: { code: "TOO_MANY_ACCOUNTS_ON_IP", message } });
}

export async function assertLoginIpCap(ip: string | undefined, user: { id: string; rights?: string | null; username?: string | null }) {
    const { maxAccountsPerIp: max, sessionActiveDays } = Config.get().automod.login;
    if (!max || max < 1 || !rulePolicy("ipAccountLimit").enabled || isStaffAccount({ id: user.id, rights: user.rights }, await loadStaffRoles())) return;
    if (await exemptionFrom("ipAccountLimit", { id: user.id, rights: user.rights ?? null })) return;
    const group = ipGroup(ip);
    if (!group || isIpCapExempt(group.ip)) return;
    const others = (await accountsSignedInFrom(group, sessionActiveDays)).filter((id) => id !== user.id);
    if (others.length < max) return;
    if (await logRefusal("login", group, others.length, max, user)) return;
    const message = `${max === 1 ? "Another account is" : `${max} other accounts are`} already signed in from this network, which is the limit on this instance. Sign out of one of them first.`;
    throw FieldErrors({ login: { code: "TOO_MANY_ACCOUNTS_ON_IP", message }, password: { code: "TOO_MANY_ACCOUNTS_ON_IP", message } });
}
