export class OffloadConfiguration {
    gateway: GatewayOffloadConfiguration = new GatewayOffloadConfiguration();
}

export class GatewayOffloadConfiguration {
    guildMembersUrl: string | null = null; // op8
    guildSyncUrl: string | null = null; // op12
    lazyRequestUrl: string | null = null; // op14
    channelStatusesUrl: string | null = null; //op36
    channelInfoUrl: string | null = null; //op43
}
