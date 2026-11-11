import { MessageCreateAttachment, MessageCreateCloudAttachment, PollCreationSchema } from "@spacebar/schemas/uncategorised";
import { AllowedMentions, EmbedList, MessageComponentList } from "../messages";
import { InteractionCallbackType } from "./InteractionCallbackType";
import { LocalizationMap } from "./ApplicationCommandCreateSchema";

export interface InteractionCallbackSchema {
    type: InteractionCallbackType;
    data?: unknown;
}
export interface PongCallback extends InteractionCallbackSchema {
    type: InteractionCallbackType.PONG;
}
export interface AckCallback extends InteractionCallbackSchema {
    type: InteractionCallbackType.ACKNOWLEDGE;
}
export interface MessageCallback extends InteractionCallbackSchema {
    type: InteractionCallbackType.CHANNEL_MESSAGE;
    data?: InteractionMessage;
}
export interface MessageWSourceCallback extends InteractionCallbackSchema {
    type: InteractionCallbackType.CHANNEL_MESSAGE_WITH_SOURCE;
    data: InteractionMessage;
}
export interface MessageDWSourceCallback extends InteractionCallbackSchema {
    type: InteractionCallbackType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE;
    data?: InteractionMessage;
}
export interface MessageUpdateCallback extends InteractionCallbackSchema {
    type: InteractionCallbackType.UPDATE_MESSAGE;
    data: InteractionMessage;
}
export interface MessageDUpdateCallback extends InteractionCallbackSchema {
    type: InteractionCallbackType.DEFERRED_UPDATE_MESSAGE;
    data?: InteractionMessage;
}
export interface AutocompleteResultCallback extends InteractionCallbackSchema {
    type: InteractionCallbackType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT;
    data: {
        /**
         * @maxItems 25
         */
        choices: {
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
        }[];
    };
}
export interface ModalCallback extends InteractionCallbackSchema {
    type: InteractionCallbackType.MODAL;
    data: {
        /**
         * @minLength 1
         * @maxLength 100
         */
        custom_id: string;
        /**
         * @minLength 1
         * @maxLength 45
         */
        title: string;
        /**
         * @minItems 1
         * @maxItems 5
         */
        components: object[];
    };
}
export interface PremiumRequiredCallback extends InteractionCallbackSchema {
    type: InteractionCallbackType.PREMIUM_REQUIRED;
}
export interface IframeModalCallback extends InteractionCallbackSchema {
    type: InteractionCallbackType.IFRAME_MODAL;
    data?: object;
}
export interface LaunchActivityCallback extends InteractionCallbackSchema {
    type: InteractionCallbackType.LAUNCH_ACTIVITY;
}
export type InteractionCallbacksSchema =
    | PongCallback
    | AckCallback
    | MessageCallback
    | MessageWSourceCallback
    | MessageDWSourceCallback
    | MessageUpdateCallback
    | MessageDUpdateCallback
    | AutocompleteResultCallback
    | ModalCallback
    | PremiumRequiredCallback
    | IframeModalCallback
    | LaunchActivityCallback;

export interface InteractionMessage {
    /**
     * @maxLength 4000
     */
    content?: string;
    tts?: boolean;
    embeds?: EmbedList;
    allowed_mentions?: AllowedMentions;
    components?: MessageComponentList;
    flags?: number;
    /**
     * @maxItems 50
     */
    attachments?: (MessageCreateAttachment | MessageCreateCloudAttachment)[];
    poll?: PollCreationSchema;
}
