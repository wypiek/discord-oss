// TODO: remove dependency on entities
import { Guild } from "@spacebar/database";

export interface GuildRecommendationsResponse {
    recommended_guilds: Guild[];
    load_id: string;
}
