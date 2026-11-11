export enum ReportMenuType {
    GUILD = "guild",
    GUILD_DISCOVERY = "guild_discovery",
    GUILD_DIRECTORY_ENTRY = "guild_directory_entry",
    GUILD_SCHEDULED_EVENT = "guild_scheduled_event",
    MESSAGE = "message",
    STAGE_CHANNEL = "stage_channel",
    FIRST_DM = "first_dm",
    USER = "user",
    APPLICATION = "application",
    WIDGET = "widget",
}

export type ReportMenuTypeNameArray = ReportMenuType[];
export const ReportMenuTypeNames: Record<ReportMenuType, string> = {
    [ReportMenuType.GUILD]: "guild",
    [ReportMenuType.GUILD_DISCOVERY]: "guild_discovery",
    [ReportMenuType.GUILD_DIRECTORY_ENTRY]: "guild_directory_entry",
    [ReportMenuType.GUILD_SCHEDULED_EVENT]: "guild_scheduled_event",
    [ReportMenuType.MESSAGE]: "message",
    [ReportMenuType.STAGE_CHANNEL]: "stage_channel",
    [ReportMenuType.FIRST_DM]: "first_dm",
    [ReportMenuType.USER]: "user",
    [ReportMenuType.APPLICATION]: "application",
    [ReportMenuType.WIDGET]: "widget",
};

export enum ReportButtonType {
    SUBMIT = "submit",
    DONE = "done",
    CANCEL = "cancel",
    NEXT = "next",
}

export interface ReportingMenuResponse {
    name: string;
    version: string;
    variant: string;
    postback_url: string;
    language?: string;
    root_node_id: number;
    success_node_id: number;
    fail_node_id: number;
    nodes: Record<number, ReportNode>;
}

export interface ReportNode {
    id: number;
    report_type?: string;
    key: string;
    header: string;
    subheader?: string;
    info?: string;
    children: ReportNodeChild[];
    elements: ReportElement[];
    button?: ReportButton;
    is_multi_select_required: boolean;
    is_auto_submit: boolean;
}

export interface ReportButton {
    type: ReportButtonType;
    target: number | null;
}

export interface ReportNodeChild {
    name: string;
    target_node_id: number;
}

export interface ReportElement {
    name: string;
    type: string;
    data: object;
    should_submit_data: boolean;
    skip_if_unlocalized: boolean;
    is_localized: boolean;
}
