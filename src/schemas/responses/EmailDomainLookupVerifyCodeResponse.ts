// TODO: remove dependency on entities
import { Guild } from "@spacebar/database";

export interface EmailDomainLookupVerifyCodeResponse {
    guild: Guild;
    joined: boolean;
}
