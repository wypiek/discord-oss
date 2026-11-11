import { HashList, ShortIdList } from "./CappedLists";
import { ActivitySchema, ClientStatus } from "@spacebar/schemas";

export type SessionsLogoutSchema = {
    /**
     * @maxItems 1000
     */
    session_ids?: ShortIdList;
    /**
     * @maxItems 1000
     */
    session_id_hashes?: HashList;
};
export type GetSessionsResponse = { user_sessions: DeviceInfo[] };

export type DeviceInfo = {
    id: string;
    id_hash: string;
    status: string;
    activities: ActivitySchema["activities"][];
    client_status: ClientStatus;
    approx_last_used_time: string;
    client_info: {
        client: string;
        os: string;
        version: number;
        location: string;
    };
    last_seen?: Date;
    last_seen_ip?: string;
    last_seen_location?: string;
};
