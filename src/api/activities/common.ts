import path from "node:path";
import { Router } from "express";
import { readTicket, signTicket } from "@spacebar/api/util/utility/mfa";

export const ACTIVITY_ASSETS = path.join(__dirname, "..", "..", "..", "assets", "activities");

const PROXY_TICKET_TTL = 12 * 3600;

export interface BuiltinActivity {
    key: string;
    name: string;
    description: string;
    tags: string[];
    shelfRank: number;
    icon: string;
    assets: { name: string; file: string }[];
    router: Router;
}

export type ActivityProxyTicket = {
    typ: "activity_proxy";
    uid: string;
    app: string;
    cid?: string;
};

export const signProxyTicket = (userId: string, applicationId: string, channelId?: string) =>
    signTicket(
        {
            typ: "activity_proxy",
            uid: userId,
            app: applicationId,
            ...(channelId && { cid: channelId }),
        },
        PROXY_TICKET_TTL,
    );

export const readProxyTicket = (ticket: unknown, applicationId: string) => {
    const decoded = readTicket<ActivityProxyTicket>(ticket, "activity_proxy");
    return decoded?.app === applicationId ? decoded : null;
};
