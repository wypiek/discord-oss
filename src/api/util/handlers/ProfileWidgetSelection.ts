import { Application, ProfileWidget, User } from "@spacebar/database";
import { FieldErrors, Snowflake } from "@spacebar/util";
import { findOversizedField, UserFieldCaps } from "@spacebar/util/util/UserFieldCaps";
import { canUseWidget, isWidgetComplete } from "@spacebar/api/util/handlers/ApplicationWidgets";
const MAX_WIDGETS = 12;
const MAX_WIDGET_SIZE = 16 * 1024;

export async function validateProfileWidgetSelection(user_id: string, widgets: unknown): Promise<ProfileWidget[]> {
    if (!Array.isArray(widgets) || widgets.length > MAX_WIDGETS)
        throw FieldErrors({
            widgets: {
                code: "BASE_TYPE_BAD_LENGTH",
                message: `Must be between 0 and ${MAX_WIDGETS} in length.`,
            },
        });

    const user = await User.findOneOrFail({
        where: { id: user_id },
        select: { id: true, profile_widgets: true },
    });
    const existing = new Set((user.profile_widgets ?? []).map((x) => x.id));
    const next: ProfileWidget[] = await Promise.all(
        widgets.map(async (widget, i) => {
            const { id, data } = (widget ?? {}) as {
                id?: unknown;
                data?: { type?: unknown; application_id?: unknown };
            };
            const invalid = (message = "Invalid widget.") => FieldErrors({ [`widgets.${i}.data`]: { code: "BASE_TYPE_INVALID", message } });
            if (typeof data?.type !== "string" || JSON.stringify(data).length > MAX_WIDGET_SIZE) throw invalid();
            const oversized = findOversizedField(data, UserFieldCaps.widgetText, UserFieldCaps.widgetItems);
            if (oversized !== null)
                throw FieldErrors({
                    [`widgets.${i}.data${oversized ? `.${oversized}` : ""}`]: {
                        code: "BASE_TYPE_MAX_LENGTH",
                        message: `Text must be ${UserFieldCaps.widgetText} or fewer in length, and lists ${UserFieldCaps.widgetItems} or fewer items.`,
                    },
                });
            if (data.type === "application") {
                const app =
                    typeof data.application_id === "string" &&
                    (await Application.findOne({
                        where: { id: data.application_id },
                        select: { id: true, owner_id: true, widget_public: true, widget_config: true },
                    }));
                if (!app || !isWidgetComplete(app.widget_config)) throw invalid("This application has no profile widget.");
                if (!(await canUseWidget(app, user_id))) throw invalid("Only the application's owner can add this widget.");
            }
            const widgetData = data.type === "application" ? { type: data.type, application_id: data.application_id as string } : (data as ProfileWidget["data"]);
            return {
                id: typeof id === "string" && existing.has(id) ? id : Snowflake.generate(),
                data: widgetData,
            };
        }),
    );
    if (new Set(next.filter((x) => x.data.type === "application").map((x) => x.data.application_id)).size !== next.filter((x) => x.data.type === "application").length)
        throw FieldErrors({
            widgets: {
                code: "BASE_TYPE_INVALID",
                message: "Each application widget can only be added once.",
            },
        });

    return next;
}
