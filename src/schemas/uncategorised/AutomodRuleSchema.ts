export interface AutomodMentionSpamRuleSchema {
    mention_total_limit: number;
    mention_raid_protection_enabled: boolean;
}

// export interface AutomodSuspectedSpamRuleSchema {}
export type AutomodSuspectedSpamRuleSchema = Record<string, never>; // hack to represent an empty object

export interface AutomodCommonlyFlaggedWordsRuleSchema {
    allow_list: [string];
    presets: [number];
}

export interface AutomodCustomWordsRuleSchema {
    allow_list: [string];
    keyword_filter: [string];
    regex_patterns: [string];
}

export interface AutomodRuleSchema {
    creator_id: string;
    enabled: boolean;
    event_type: number; // No idea...
    exempt_channels: [string];
    exempt_roles: [string];
    guild_id: string;
    name: string;
    position: number;
    trigger_type: number; //AutomodTriggerTypes
    trigger_metadata: AutomodMentionSpamRuleSchema | AutomodSuspectedSpamRuleSchema | AutomodCommonlyFlaggedWordsRuleSchema | AutomodCustomWordsRuleSchema;
}

export interface AutomodRuleSchemaWithId extends AutomodRuleSchema {
    id: string;
}
