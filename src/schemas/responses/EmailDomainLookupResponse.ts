export interface HubGuild {
    icon: string;
    id: string;
    name: string;
}

export interface EmailDomainLookupResponse {
    guilds_info: HubGuild[];
    has_matching_guild: boolean;
}
