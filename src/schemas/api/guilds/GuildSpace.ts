export type GuildSpaceWidgetType = "leaderboard" | "whiteboard" | "popular_music" | "image_text" | "popular_games";

export const GuildSpacePublishStatus = { DRAFT: 0, PUBLISHED: 1 } as const;

export type GuildSpacePublishStatusValue = 0 | 1;

export interface GuildSpaceSettings {
    enabled: boolean;
    publish_status: GuildSpacePublishStatusValue;
}

export const guildSpaceSettingsOf = (state?: Partial<GuildSpaceSettings> | null): GuildSpaceSettings => ({
    enabled: state?.enabled !== false,
    publish_status: state?.publish_status === GuildSpacePublishStatus.PUBLISHED ? GuildSpacePublishStatus.PUBLISHED : GuildSpacePublishStatus.DRAFT,
});

export interface GuildSpaceWidgetPosition {
    /**
     * @minimum 0
     * @maximum 1
     */
    column: number;
    /**
     * @minimum 0
     * @maximum 99
     */
    order: number;
}

export interface GuildSpaceWidgetConfig {
    type: GuildSpaceWidgetType;
    /**
     * @maxLength 100
     */
    title?: string | null;
    /**
     * @maxLength 500
     */
    text?: string | null;
    /**
     * @maxLength 128
     */
    image_hash?: string | null;
    image?: string | null;
}

export interface GuildSpaceStoredWidget {
    id: string;
    type: GuildSpaceWidgetType;
    position: GuildSpaceWidgetPosition;
    config: GuildSpaceWidgetConfig;
}

export interface GuildSpaceState extends GuildSpaceSettings {
    channel_id?: string | null;
    custom_banner_hash?: string | null;
    widgets?: GuildSpaceStoredWidget[] | null;
}

export interface GuildSpaceWidgetUpdate {
    /**
     * @maxLength 64
     */
    id?: string;
    type: GuildSpaceWidgetType;
    position: GuildSpaceWidgetPosition;
    config: GuildSpaceWidgetConfig;
}

export interface GuildSpaceUpdateSchema {
    header?: {
        custom_banner?: string | null;
    };
    /**
     * @maxItems 12
     */
    widgets: GuildSpaceWidgetUpdate[];
}

export interface GuildSpaceSettingsModifySchema {
    enabled?: boolean;
    publish_status?: GuildSpacePublishStatusValue;
}
