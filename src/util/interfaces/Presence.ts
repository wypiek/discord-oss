import { ClientStatus, Status, PublicUser } from "@spacebar/schemas";
import { Activity } from "./Activity";

export interface Presence {
    user: PublicUser | { id: string };
    guild_id?: string;
    status: Status;
    activities: Activity[];
    client_status: ClientStatus;
    processed_at_timestamp?: number;
}
