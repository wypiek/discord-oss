import crypto from "node:crypto";
import { CaptchaConfiguration, TwoFactorConfiguration, WebPushConfiguration } from "./subconfigurations";

export class SecurityConfiguration {
    captcha: CaptchaConfiguration = new CaptchaConfiguration();
    twoFactor: TwoFactorConfiguration = new TwoFactorConfiguration();
    webPush: WebPushConfiguration = new WebPushConfiguration();
    requestSignature: string = crypto.randomBytes(32).toString("base64");
    jwtSecret: string | null = null;
    // header to get the real user ip address
    // X-Forwarded-For for nginx/reverse proxies
    // CF-Connecting-IP for cloudflare
    forwardedFor: string | null = null;
    // trusted proxies to get the real user ip address
    // requires a reverse proxy to overwrite X-Forwarded-For, X-Forwarded-Host, X-Forwarded-Proto
    trustedProxies: string | boolean | null = null;
    abuseIpDbApiKey: string | null = null;
    // https://docs.abuseipdb.com/#api-daily-rate-limits
    abuseipdbBlacklistRatelimit: number = 5;
    abuseipdbConfidenceScoreTreshold: number = 50;
    ipdataApiKey: string | null = null;
    mfaBackupCodeCount: number = 10;
    statsWorldReadable: boolean = true;
    defaultRegistrationTokenExpiration: number = 1000 * 60 * 60 * 24 * 7; //1 week
    // cdn signed urls
    cdnSignUrls: boolean = false;
    cdnSignatureKey: string = crypto.randomBytes(32).toString("base64");
    cdnSignatureDuration: string = "24h";
    cdnSignatureIncludeIp: boolean = true;
    cdnSignatureIncludeUserAgent: boolean = true;
    allowPrivateNetworkRequests: boolean = false;
}
