import { Snowflake } from "@spacebar/schemas";

export interface Team {
    id: Snowflake;
    name: string;
    icon: string | null;
    owner_user_id: Snowflake;
    // members?: TeamMember[]; // TODO: only in application object
    // TODO: only on Get/List Team(s) w/ include_payout_account_status=true
    // payout_account_status?: TeamPayoutAccountStatus | null;
    // payout_account_statuses?: TeamPayoutAccount[];
    // TODO: Get Team only
    // stripe_connect_account_id?: string;
}

export type TeamListResponse = Team[];
