import { Config } from "@spacebar/util";
import { DateBuilder } from "@spacebar/extensions";

// https://www.stopforumspam.com/usage
export class StopForumSpamClient {
    private static stopForumSpamIpCache: Map<
        string,
        {
            data: StopForumSpamResponse["ip"];
            expires: number;
        }
    > = new Map();
    private static stopForumSpamEmailCache: Map<
        string,
        {
            data: StopForumSpamResponse["email"];
            expires: number;
        }
    > = new Map();
    private static stopForumSpamUsernameCache: Map<
        string,
        {
            data: StopForumSpamResponse["username"];
            expires: number;
        }
    > = new Map();

    public static async checkAsync(email?: string, ipAddress?: string, username?: string): Promise<StopForumSpamResponse> {
        if (!Config.get().externalRequests.thirdParty) return { success: 1 };
        const params = new URLSearchParams();
        const cachedResults: StopForumSpamResponse = { success: 1 };
        if (email) {
            const cachedEmail = StopForumSpamClient.stopForumSpamEmailCache.get(email);
            if (cachedEmail && cachedEmail.expires > Date.now()) cachedResults.email = cachedEmail.data;
            else params.append("email", email);
        }
        if (ipAddress) {
            const cachedIp = StopForumSpamClient.stopForumSpamIpCache.get(ipAddress);
            if (cachedIp && cachedIp.expires > Date.now()) cachedResults.ip = cachedIp.data;
            else params.append("ip", ipAddress);
        }
        if (username) {
            const cachedUsername = StopForumSpamClient.stopForumSpamUsernameCache.get(username);
            if (cachedUsername && cachedUsername.expires > Date.now()) cachedResults.username = cachedUsername.data;
            else params.append("username", username);
        }

        if (params.toString() === "") {
            // We don't need to fetch anything...
            return cachedResults;
        }

        const response = await fetch(`https://api.stopforumspam.org/api?${params.toString()}&json&confidence`, {
            method: "GET",
            signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) {
            console.error(`StopForumSpam API request failed with status ${response.status}`);
            throw new Error(`StopForumSpam API request failed with status ${response.status}`);
        }

        const data = (await response.json()) as StopForumSpamResponse;
        if (data.success !== 1) {
            console.error("StopForumSpam API request was not successful");
            throw new Error("StopForumSpam API request was not successful");
        }

        if (data.ip)
            StopForumSpamClient.stopForumSpamIpCache.set(data.ip.value, {
                data: data.ip,
                expires: new DateBuilder().addHours(12).buildTimestamp(),
            });

        if (data.email)
            StopForumSpamClient.stopForumSpamEmailCache.set(data.email.value, {
                data: data.email,
                expires: new DateBuilder().addHours(12).buildTimestamp(),
            });

        if (data.username)
            StopForumSpamClient.stopForumSpamUsernameCache.set(data.username.value, {
                data: data.username,
                expires: new DateBuilder().addHours(12).buildTimestamp(),
            });

        return data;
    }
}
export interface StopForumSpamResponse {
    success: 0 | 1;
    ip?: {
        value: string;
        appears: 0 | 1;
        lastseen: string;
        frequency: number;
        confidence?: number;
        delegated: string;
    };
    email?: {
        value: string;
        appears: 0 | 1;
        lastseen: string;
        frequency: number;
        confidence?: number;
    };
    username?: {
        value: string;
        appears: 0 | 1;
        lastseen: string;
        frequency: number;
        confidence?: number;
    };
}
