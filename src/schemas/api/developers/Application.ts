import { LocalizationMap } from "../bots/ApplicationCommandCreateSchema";

export interface ApplicationCommand {
    id: string;
    application_id: string;
    name: string;
    description: string;
    options?: ApplicationCommandOption[];
}

export interface ApplicationCommandOption {
    type: ApplicationCommandOptionType;
    /**
     * @minLength 1
     * @maxLength 32
     */
    name: string;
    name_localizations?: LocalizationMap | null;
    /**
     * @minLength 1
     * @maxLength 100
     */
    description: string;
    description_localizations?: LocalizationMap | null;
    required?: boolean;
    /**
     * @maxItems 25
     */
    choices?: ApplicationCommandOptionChoice[];
    /**
     * @maxItems 25
     */
    options?: ApplicationCommandOption[];
    /**
     * @maxItems 32
     */
    channel_types?: number[];
    min_value?: number;
    max_value?: number;
    /**
     * @minimum 0
     * @maximum 6000
     */
    min_length?: number;
    /**
     * @minimum 1
     * @maximum 6000
     */
    max_length?: number;
    autocomplete?: boolean;
}

export interface ApplicationCommandOptionChoice {
    /**
     * @minLength 1
     * @maxLength 100
     */
    name: string;
    name_localizations?: LocalizationMap | null;
    /**
     * @maxLength 100
     */
    value: string | number;
}

export enum ApplicationCommandOptionType {
    SUB_COMMAND = 1,
    SUB_COMMAND_GROUP = 2,
    STRING = 3,
    INTEGER = 4,
    BOOLEAN = 5,
    USER = 6,
    CHANNEL = 7,
    ROLE = 8,
    MENTIONABLE = 9,
    NUMBER = 10,
    ATTACHMENT = 11,
}

export interface ApplicationCommandInteractionData {
    id: string;
    name: string;
    options?: ApplicationCommandInteractionDataOption[];
}

export interface ApplicationCommandInteractionDataOption {
    name: string;
    value?: unknown;
    options?: ApplicationCommandInteractionDataOption[];
}
