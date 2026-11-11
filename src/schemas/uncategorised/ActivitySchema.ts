import { ClientStatus, SetPrivateStatus } from "@spacebar/schemas";
import { Activity } from "@spacebar/util";

export const ActivitySchema = {
    $afk: Boolean,
    status: String,
    $activities: [Object],
    $since: Number, // unix time (in milliseconds) of when the client went idle, or null if the client is not idle
};

export interface ActivitySchema {
    afk?: boolean;
    status: SetPrivateStatus;
    activities?: Activity[];
    since?: number; // unix time (in milliseconds) of when the client went idle, or null if the client is not idle
    client_status?: ClientStatus;
}
