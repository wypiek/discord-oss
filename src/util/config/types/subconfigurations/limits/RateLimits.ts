import { RateLimitOptions, RouteRateLimit } from "./ratelimits/index";

export class RateLimits {
    enabled: boolean = true;
    ip: RateLimitOptions = {
        count: 500,
        window: 5,
    };
    global: RateLimitOptions = {
        count: 250,
        window: 5,
    };
    error: RateLimitOptions = {
        count: 10000,
        window: 600,
    };
    identify: RateLimitOptions = {
        count: 12,
        bot: 60,
        window: 60,
    };
    routes: RouteRateLimit = new RouteRateLimit();
}
