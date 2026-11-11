// TODO: clean up util imports
import { GeneralConfiguration, LimitsConfiguration } from "../../util/config/types";
import { DmChannelDTO } from "../../util/dtos";
// TODO: remove entity imports
import { Application, Categories, Channel, Guild, Invite, Template } from "@spacebar/database";
import { GuildCreateResponse, PrivateUser } from "@spacebar/schemas";

// TODO: remove this entire file!
// removes internal properties from the guild class
export type APIGuild = Omit<Guild, "afk_channel" | "template" | "owner" | "public_updates_channel" | "rules_channel" | "system_channel" | "widget_channel">;
export type APIGuildArray = APIGuild[];
export type APIDMChannelArray = DmChannelDTO[];

export interface UserUpdateResponse extends PrivateUser {
    newToken?: string;
}

export type ApplicationDetectableResponse = unknown[];
export type ApplicationEntitlementsResponse = unknown[];
export type ApplicationSkusResponse = unknown[];
export type APIApplicationArray = Application[];
export type APIDiscoveryCategoryArray = Categories[];
export type APIChannelArray = Channel[];

export interface APIGuildWithJoinedAt extends GuildCreateResponse {
    joined_at: string;
}

export type APITemplateArray = Template[];
export type APIGeneralConfiguration = GeneralConfiguration;
export type APILimitsConfiguration = LimitsConfiguration;

export type APIConnectionsConfiguration = Record<
    string,
    {
        enabled: boolean;
    }
>;
