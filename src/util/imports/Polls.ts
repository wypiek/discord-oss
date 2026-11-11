import { Snowflake } from "@spacebar/util";

interface PendingPoll {
    expiry: number;
    position: number;
}

export const pendingPolls = new Map<Snowflake, PendingPoll>();
