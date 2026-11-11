import { Snowflake } from "../Identifiers";

export interface GuildWidgetSettingsResponse {
    enabled: boolean;
    channel_id: Snowflake | null;
}
