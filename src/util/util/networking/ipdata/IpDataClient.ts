import { DateBuilder } from "@spacebar/extensions";
import { Config } from "@spacebar/util";
import { IpDataIpLookupResponse } from "./IpDataSampleResponses";

export class IpDataClient {
    private static ipInfoCache: Map<
        string,
        {
            data: IpDataIpLookupResponse;
            expires: number;
        }
    > = new Map();

    static async getIpInfo(ip: string): Promise<IpDataIpLookupResponse | null> {
        if (!Config.get().externalRequests.thirdParty) return null;
        const { ipdataApiKey } = Config.get().security;
        if (!ipdataApiKey) return null;
        if ((this.ipInfoCache.get(ip)?.expires ?? 0) > Date.now()) return this.ipInfoCache.get(ip)!.data;

        const response = await fetch(`https://eu-api.ipdata.co/${encodeURIComponent(ip)}?api-key=${encodeURIComponent(ipdataApiKey)}`, { signal: AbortSignal.timeout(10_000) });
        if (!response.ok) return null;
        const data = (await response.json()) as IpDataIpLookupResponse;
        this.ipInfoCache.set(ip, {
            data: data,
            expires: new DateBuilder().addHours(12).buildTimestamp(),
        });
        return data;
    }
}
