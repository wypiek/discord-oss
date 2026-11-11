import { Config, fetchPublicUrl } from "@spacebar/util";
import { ProcessLifecycle } from "../../../util/util/ProcessLifecycle";
import { findScamLink, parseScamList, ScamMatch } from "@spacebar/util/util/ScamLinks";

const DAY = 24 * 60 * 60 * 1000;
const MAX_LIST_BYTES = 8 * 1024 * 1024;

const remote = {
    domains: new Set<string>() as ReadonlySet<string>,
    url: "",
    fetchedAt: null as Date | null,
    error: null as string | null,
    running: false,
};
let timer: NodeJS.Timeout | null = null;

export function ownHosts() {
    const { general, api, cdn, gateway } = Config.get();
    const hosts = new Set<string>();
    for (const value of [general.serverName, api.endpointPublic, cdn.endpointPublic, gateway.endpointPublic]) {
        if (!value) continue;
        try {
            hosts.add(new URL(/^[a-z]+:\/\//i.test(value) ? value : `https://${value}`).hostname.toLowerCase());
        } catch {}
    }
    return [...hosts];
}

export function scamMatchFor(content: string | null | undefined, accountCreatedAt: number, now = Date.now()): ScamMatch | null {
    const scam = Config.get().automod.scam;
    if (!scam.enabled || !content) return null;
    return findScamLink(content, {
        ownHosts: ownHosts(),
        allowDomains: scam.allowDomains,
        extraDomains: scam.extraDomains,
        remoteDomains: remote.url === scam.remoteListUrl ? remote.domains : undefined,
        newAccount: scam.shortenerAccountAgeDays > 0 && now - accountCreatedAt < scam.shortenerAccountAgeDays * DAY,
        lookalikes: scam.lookalikes,
        giftBait: scam.giftBait,
        qrLogin: scam.qrLogin,
        ipLoggers: scam.ipLoggers,
    });
}

export const describeScam = (match: ScamMatch) => `${match.kind.replace("_", " ")}${match.host ? ` ${match.host}` : ""}: ${match.reason}`.slice(0, 200);

export const scamListStatus = () => ({
    url: remote.url || null,
    domains: remote.domains.size,
    fetched_at: remote.fetchedAt,
    error: remote.error,
});

export async function refreshScamList() {
    const { remoteListUrl } = Config.get().automod.scam;
    if (!remoteListUrl) {
        remote.domains = new Set();
        remote.url = "";
        remote.fetchedAt = null;
        remote.error = null;
        return scamListStatus();
    }
    if (remote.running) return scamListStatus();
    remote.running = true;
    try {
        const response = await fetchPublicUrl(remoteListUrl, { headers: { accept: "text/plain, application/json" } }, 2, { maxBytes: MAX_LIST_BYTES, timeoutMs: 20_000 });
        if (!response.ok) throw new Error(`the list answered ${response.status}`);
        const domains = parseScamList(Buffer.from(await response.arrayBuffer()).toString("utf8"));
        remote.domains = domains;
        remote.url = remoteListUrl;
        remote.fetchedAt = new Date();
        remote.error = null;
        console.log(`[Automod] loaded ${domains.size} scam domains from ${remoteListUrl}`);
    } catch (error) {
        remote.error = (error as Error).message ?? String(error);
        console.error(`[Automod] couldn't load the scam list from ${remoteListUrl}:`, remote.error);
    } finally {
        remote.running = false;
    }
    return scamListStatus();
}

const due = { last: 0, attempted: null as string | null };

export function refreshScamListWhenDue() {
    const { remoteListUrl, remoteListRefreshMinutes } = Config.get().automod.scam;
    const every = Math.max(15, remoteListRefreshMinutes || 360) * 60_000;
    if (remoteListUrl === due.attempted && Date.now() - due.last < every) return undefined;
    due.attempted = remoteListUrl;
    due.last = Date.now();
    return refreshScamList().catch(() => undefined);
}

export function startScamListRefresh() {
    if (timer) return;
    let stopped = false;
    let refreshing: Promise<unknown> | undefined;
    const tick = () => {
        if (stopped) return;
        refreshing = refreshScamListWhenDue() ?? refreshing;
    };
    tick();
    timer = setInterval(tick, 60_000);
    timer.unref?.();
    ProcessLifecycle.eventEmitter.once("stopping", async () => {
        stopped = true;
        if (timer) clearInterval(timer);
        await refreshing;
    });
}
