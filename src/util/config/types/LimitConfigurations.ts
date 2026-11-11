import { ApplicationLimits, ChannelLimits, E2eeLimits, GatewayLimits, GlobalRateLimits, GuildLimits, MessageLimits, RateLimits, UserLimits } from "./subconfigurations/limits";

export class LimitsConfiguration {
    application: ApplicationLimits = new ApplicationLimits();
    user: UserLimits = new UserLimits();
    guild: GuildLimits = new GuildLimits();
    message: MessageLimits = new MessageLimits();
    channel: ChannelLimits = new ChannelLimits();
    rate: RateLimits = new RateLimits();
    absoluteRate: GlobalRateLimits = new GlobalRateLimits();
    e2ee: E2eeLimits = new E2eeLimits();
    gateway: GatewayLimits = new GatewayLimits();
}
