export class DiscoveryConfiguration {
    showAllGuilds: boolean = false;
    useRecommendation: boolean = false; // TODO: Recommendation, privacy concern?
    offset: number = 0;
    limit: number = 24;
    // Discord lists the servers you're in too; hiding them means whoever adds a server never sees it in Discovery
    hideJoinedGuilds: boolean = false;
}
