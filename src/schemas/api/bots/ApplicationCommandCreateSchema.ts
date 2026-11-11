import { ApplicationCommandHandlerType, ApplicationCommandOption, ApplicationCommandType, ApplicationIntegrationType, InteractionContextType } from "@spacebar/schemas";

/**
 * @maxProperties 40
 */
export type LocalizationMap = { [locale: string]: string };

export interface ApplicationCommandCreateSchema {
    type?: ApplicationCommandType;
    /**
     * @minLength 1
     * @maxLength 32
     */
    name: string;
    name_localizations?: LocalizationMap | null;
    /**
     * @maxLength 100
     */
    description?: string;
    description_localizations?: LocalizationMap | null;
    /**
     * @maxItems 25
     */
    options?: ApplicationCommandOption[];
    /**
     * @maxLength 32
     */
    default_member_permissions?: string;
    /*
     * @deprecated
     */
    dm_permission?: boolean;
    nsfw?: boolean;
    /**
     * @maxItems 2
     */
    integration_types?: ApplicationIntegrationType[];
    /**
     * @maxItems 3
     */
    contexts?: InteractionContextType[];
    handler?: ApplicationCommandHandlerType;
}

/**
 * @maxItems 110
 */
export type BulkApplicationCommandCreateSchema = ApplicationCommandCreateSchema[];

export interface ApplicationCommandModifySchema {
    /**
     * @minLength 1
     * @maxLength 32
     */
    name?: string;
    name_localizations?: LocalizationMap | null;
    /**
     * @maxLength 100
     */
    description?: string;
    description_localizations?: LocalizationMap | null;
    /**
     * @maxItems 25
     */
    options?: ApplicationCommandOption[];
    /**
     * @maxLength 32
     */
    default_member_permissions?: string | null;
    dm_permission?: boolean;
    nsfw?: boolean;
    /**
     * @maxItems 2
     */
    integration_types?: ApplicationIntegrationType[];
    /**
     * @maxItems 3
     */
    contexts?: InteractionContextType[];
    handler?: ApplicationCommandHandlerType;
}

export interface ApplicationCommandPermissionsUpdateSchema {
    /**
     * @maxItems 100
     */
    permissions: {
        /**
         * @maxLength 64
         */
        id: string;
        type: 1 | 2 | 3;
        permission: boolean;
    }[];
}
