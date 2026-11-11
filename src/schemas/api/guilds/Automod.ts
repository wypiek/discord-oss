import { Snowflake } from "../../Identifiers";

export type AutomodRuleTriggerMetadata = AutomodMentionSpamRule | AutomodSuspectedSpamRule | AutomodCommonlyFlaggedWordsRule | AutomodCustomWordsRule;

export class AutomodMentionSpamRule {
    mention_total_limit: number;
    mention_raid_protection_enabled: boolean;
}

export class AutomodSuspectedSpamRule {}

export class AutomodCommonlyFlaggedWordsRule {
    allow_list: string[];
    presets: AutomodKeywordPresetType[];
}

export class AutomodCustomWordsRule {
    allow_list: string[];
    keyword_filter: string[];
    regex_patterns: string[];
}

export enum AutomodRuleEventType {
    MESSAGE_SEND = 1,
    GUILD_MEMBER_EVENT = 2,
}
export enum AutomodRuleTriggerType {
    KEYWORD = 1,
    HARMFUL_LINK = 2,
    SPAM = 3,
    KEYWORD_PRESET = 4,
    MENTION_SPAM = 5,
    USER_PROFILE = 6,
    GUILD_POLICY = 7,
}

export enum AutomodKeywordPresetType {
    PROFANITY = 1,
    SEXUAL_CONTENT = 2,
    SLURS = 3,
}

export enum AutomodRuleActionType {
    BLOCK_MESSAGE = 1,
    SEND_ALERT_MESSAGE = 2,
    TIMEOUT_USER = 3,
    QUARANTINE_USER = 4,
}

export type AutomodAction =
    | {
          type: AutomodRuleActionType.BLOCK_MESSAGE;
          metadata: {
              custom_message?: string;
          };
      }
    | {
          type: AutomodRuleActionType.SEND_ALERT_MESSAGE;
          metadata: {
              channel_id: Snowflake;
          };
      }
    | {
          type: AutomodRuleActionType.TIMEOUT_USER;
          metadata: {
              duration_seconds: number;
          };
      }
    | {
          type: AutomodRuleActionType.QUARANTINE_USER;
          metadata: {
              duration_seconds: number;
          };
      };

// TODO
// eslint-disable-next-line
export interface AutomodRuleActionMetadata {}
