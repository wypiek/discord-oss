import { DateBuilder } from "@spacebar/extensions";
import { Config } from "@spacebar/util";
import { AbuseIpDbBlacklistResponse, AbuseIpDbCheckResponse } from "./AbuseIpDbSampleResponses";

export class AbuseIpDbClient {
    private static ipCheckCache: Map<
        string,
        {
            data: AbuseIpDbCheckResponse;
            expires: number;
        }
    > = new Map();

    private static blacklistCache: {
        data: AbuseIpDbBlacklistResponse;
        expires: number;
    } | null = null;

    static async checkIpAddress(ip: string): Promise<AbuseIpDbCheckResponse | null> {
        if (!Config.get().externalRequests.thirdParty) return null;
        const { abuseIpDbApiKey } = Config.get().security;
        if (!abuseIpDbApiKey) return null;
        if ((this.ipCheckCache.get(ip)?.expires ?? 0) > Date.now()) return this.ipCheckCache.get(ip)!.data;

        const response = await fetch(`https://api.abuseipdb.com/api/v2/check?ipAddress=${encodeURIComponent(ip)}`, {
            headers: { Key: abuseIpDbApiKey, Accept: "application/json" },
            signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) return null;
        const resp = (await response.json()) as AbuseIpDbCheckResponse;
        this.ipCheckCache.set(ip, {
            data: resp,
            expires: new DateBuilder().addHours(12).buildTimestamp(),
        });
        return resp;
    }

    static async getBlacklist(): Promise<AbuseIpDbBlacklistResponse | null> {
        if (!Config.get().externalRequests.thirdParty) return null;
        const { abuseIpDbApiKey, abuseipdbBlacklistRatelimit } = Config.get().security;
        if (!abuseIpDbApiKey) return null;
        if ((this.blacklistCache?.expires ?? 0) > Date.now()) return this.blacklistCache!.data;

        console.log("[AbuseIPDB] Fetching blacklist...");
        const response = await fetch(`https://api.abuseipdb.com/api/v2/blacklist`, {
            headers: {
                Key: abuseIpDbApiKey,
                Accept: "application/json",
            },
            signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) return null;
        const resp = (await response.json()) as AbuseIpDbBlacklistResponse;

        this.blacklistCache = {
            data: resp,
            expires: new DateBuilder().addHours(Math.ceil(24 / abuseipdbBlacklistRatelimit)).buildTimestamp(),
        };

        return resp;
    }

    static async isIpBlacklisted(ip: string): Promise<boolean> {
        const { abuseipdbConfidenceScoreTreshold } = Config.get().security;
        const blacklist = await this.getBlacklist();
        if (!blacklist) return false;

        const entry = blacklist.data.find((x) => x.ipAddress === ip);
        if (!entry) return false;

        return entry.abuseConfidenceScore >= abuseipdbConfidenceScoreTreshold;
    }
}
