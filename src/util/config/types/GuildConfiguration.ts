import { DiscoveryConfiguration, AutoJoinConfiguration, SafetyConfiguration } from "./subconfigurations";

export class GuildConfiguration {
    discovery: DiscoveryConfiguration = new DiscoveryConfiguration();
    autoJoin: AutoJoinConfiguration = new AutoJoinConfiguration();
    defaultFeatures: string[] = [];
    publicThreadsInvitable: boolean = false;
    safety: SafetyConfiguration = new SafetyConfiguration();
}
