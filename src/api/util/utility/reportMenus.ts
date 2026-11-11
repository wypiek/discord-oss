import { ReportMenuType, type CreateReportSchema } from "@spacebar/schemas";
import { FieldErrors } from "@spacebar/util";

type LocalReportNode = {
    id: number;
    key: string;
    header: string;
    subheader: string;
    children: [string, number][];
    elements: {
        name: string;
        type: string;
        data: null;
        should_submit_data: boolean;
        skip_if_unlocalized: boolean;
        is_localized: boolean;
    }[];
    button?: { type: "submit" | "done" | "cancel"; target: null };
    is_multi_select_required: boolean;
    is_auto_submit: boolean;
};
export type LocalReportMenu = {
    name: string;
    version: string;
    variant: string;
    postback_url: string;
    root_node_id: number;
    success_node_id: number;
    fail_node_id: number;
    nodes: Record<number, LocalReportNode>;
};

const reasons = ["Hateful language", "Harassment or threats", "Spam or scams", "Sexual or violent content", "Privacy violation", "Other safety concern"];
const previews: Partial<Record<ReportMenuType, string>> = {
    message: "message_preview",
    first_dm: "message_preview",
    user: "user_preview",
    guild: "guild_preview",
    guild_discovery: "guild_preview",
    application: "app_preview",
    widget: "widget_preview",
};
const element = (type: string) => ({
    name: type,
    type,
    data: null,
    should_submit_data: false,
    skip_if_unlocalized: false,
    is_localized: true,
});
const node = (id: number, header: string, key: string): LocalReportNode => ({
    id,
    key,
    header,
    subheader: "",
    children: [],
    elements: [],
    is_multi_select_required: false,
    is_auto_submit: false,
});
const menus = new Map<string, LocalReportMenu>();
for (const type of Object.values(ReportMenuType)) {
    const root = node(1000, "What would you like staff to review?", "LOCAL_REPORT_ROOT");
    root.subheader = "Choose the reason that best describes the problem.";
    root.button = { type: "cancel", target: null };
    root.elements = previews[type] ? [element(previews[type]!)] : [];
    const nodes: Record<number, LocalReportNode> = { 1000: root };
    for (const [index, reason] of reasons.entries()) {
        const id = 1010 + index;
        root.children.push([reason, id]);
        const submit = node(id, reason, "LOCAL_REPORT_SUBMIT");
        submit.subheader = "Submit this report for instance staff to review.";
        submit.button = { type: "submit", target: null };
        submit.elements = [...(previews[type] ? [element(previews[type]!)] : []), element("breadcrumbs")];
        nodes[id] = submit;
    }
    nodes[1900] = {
        ...node(1900, "Report sent", "LOCAL_REPORT_SUCCESS"),
        subheader: "Instance staff can now review your report.",
        button: { type: "done", target: null },
        elements: [element("success")],
    };
    nodes[1901] = {
        ...node(1901, "Report could not be sent", "LOCAL_REPORT_FAIL"),
        subheader: "Try again in a moment.",
        button: { type: "done", target: null },
        elements: [element("fail")],
    };
    menus.set(type, {
        name: type,
        version: "2.0",
        variant: "local",
        postback_url: `/api/v9/reporting/${type}`,
        root_node_id: 1000,
        success_node_id: 1900,
        fail_node_id: 1901,
        nodes,
    });
}

export const getReportingMenu = (type: string) => menus.get(type);

export function validateReportMenu(body: CreateReportSchema, menu: LocalReportMenu) {
    const invalid = (field: string, code: string, message: string) => {
        throw FieldErrors({ [field]: { code, message } });
    };
    if (body.version !== menu.version) invalid("version", "INVALID_REPORT_MENU_VERSION", "Reload the reporting menu before submitting.");
    if (body.variant !== menu.variant) invalid("variant", "INVALID_REPORT_MENU_VARIANT", "Reload the reporting menu before submitting.");
    if (!Array.isArray(body.breadcrumbs) || body.breadcrumbs.length !== 2 || body.breadcrumbs[0] !== menu.root_node_id || !body.breadcrumbs.every(Number.isSafeInteger))
        invalid("breadcrumbs", "INVALID_REPORT_MENU_BREADCRUMBS_PATH", "Choose a report reason before submitting.");
    const target = body.breadcrumbs[1];
    if (!menu.nodes[menu.root_node_id].children.some(([, id]) => id === target) || menu.nodes[target]?.button?.type !== "submit")
        invalid("breadcrumbs", "INVALID_REPORT_MENU_BREADCRUMBS_PATH", "Choose a valid report reason before submitting.");
}
