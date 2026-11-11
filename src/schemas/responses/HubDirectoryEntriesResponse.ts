// TODO: remove dependency on entities
import { Guild } from "@spacebar/database";

export interface HubDirectoryEntry {
    author_id: string;
    created_at: string;
    description: string;
    directory_channel_id: string;
    guild: Guild;
    primary_category_id: number;
    type: HubDirectoryEntryType;
}

export enum HubDirectoryEntryType {
    GUILD = 0,
    GUILD_SCHEDULED_EVENT = 1,
}

export enum HubDirectoryCategory {
    UNCATEGORIZED = 0,
    SCHOOL_CLUB = 1,
    CLASS = 2,
    STUDY_SOCIAL = 3,
    SUBJECT_MAJOR = 4,
    MISC = 5,
}

export type HubDirectoryEntriesResponse = HubDirectoryEntry[];
