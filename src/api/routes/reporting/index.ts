import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { ReportMenuTypeNames, ReportMenuType, type CreateReportSchema } from "@spacebar/schemas";
import { FieldErrors } from "@spacebar/util";
import { createReport } from "@spacebar/api/util";

import { getReportingMenu, validateReportMenu } from "../../util/utility/reportMenus";

const router = Router({ mergeParams: true });
if (process.env.LOG_ROUTES !== "false") console.log("[Server] Registering reporting menu routes...");
router.get(
    "/",
    route({
        description: "[EXT] Get available reporting menu types.",
        responses: {
            200: {
                body: "ReportMenuTypeNames",
            },
        },
    }),
    (req: Request, res: Response) => {
        res.json(Object.values(ReportMenuTypeNames));
    },
);

for (const type of Object.values(ReportMenuTypeNames)) {
    router.get(
        `/menu/${type}`,
        route({
            description: `Get reporting menu options for ${type} reports.`,
            query: {
                variant: {
                    type: "string",
                    required: false,
                    description: "Version variant of the menu to retrieve (max 256 characters, default active)",
                },
            },
            responses: {
                200: {
                    body: "ReportingMenuResponse",
                },
                204: {},
            },
            spacebarOnly: false, // Maps to /reporting/menu/:id
        }),
        (req: Request, res: Response) => {
            res.json(getReportingMenu(type));
        },
    );
    if (process.env.LOG_ROUTES !== "false") console.log(`[Server] Route /reporting/menu/${type} registered (reports).`);
    // noinspection JSUnusedLocalSymbols - TODO: implement
    router.post(
        `/${type}`,
        route({
            description: `Submit a ${type} report to the instance staff.`,
            requestBody: "CreateReportSchema",
            responses: {
                200: {
                    body: "CreateReportResponse",
                },
                204: {},
            },
            spacebarOnly: false, // Maps to /reporting/:id
        }),
        async (req: Request, res: Response) => {
            const body = req.body as CreateReportSchema;
            if (body.name !== type)
                throw FieldErrors({
                    name: {
                        message: `Expected report type ${type} but got ${body.name}`,
                        code: "INVALID_REPORT_TYPE",
                    },
                });

            const menuData = getReportingMenu(type)!;
            validateReportMenu(body, menuData);

            const requireFields = (obj: CreateReportSchema, fields: string[]) => {
                const missingFields: string[] = [];
                for (const field of fields) if (!(field in obj)) missingFields.push(field);

                if (missingFields.length > 0)
                    throw FieldErrors(
                        Object.fromEntries(
                            missingFields.map((f) => [
                                f,
                                {
                                    message: `Missing required field ${f}.`,
                                    code: "MISSING_FIELD",
                                },
                            ]),
                        ),
                    );
            };

            switch (type) {
                case ReportMenuType.GUILD:
                case ReportMenuType.GUILD_DISCOVERY:
                    requireFields(body, ["guild_id"]);
                    break;
                case ReportMenuType.GUILD_DIRECTORY_ENTRY:
                    requireFields(body, ["guild_id", "channel_id"]);
                    break;
                case ReportMenuType.GUILD_SCHEDULED_EVENT:
                    requireFields(body, ["guild_id", "guild_scheduled_event_id"]);
                    break;
                case ReportMenuType.MESSAGE:
                    requireFields(body, ["channel_id", "message_id"]);
                    // NOTE: is body.guild_id set if the channel is in a guild? is body.user_id ever set????
                    break;
                case ReportMenuType.STAGE_CHANNEL:
                    requireFields(body, ["channel_id", "guild_id", "stage_instance_id"]);
                    break;
                case ReportMenuType.FIRST_DM:
                    requireFields(body, ["channel_id", "message_id"]);
                    break;
                case ReportMenuType.USER:
                    if (!body.user_id && !body.reported_user_id) requireFields(body, ["user_id"]);
                    break;
                case ReportMenuType.APPLICATION:
                    requireFields(body, ["application_id"]);
                    break;
                case ReportMenuType.WIDGET:
                    requireFields(body, ["user_id", "widget_id"]);
                    break;
                default:
                    throw new HTTPError("Unknown report menu type", 400);
            }

            const report = await createReport(type, body, req.user_id, menuData);
            res.json({ report_id: report.id, id: report.id });
        },
    );
    if (process.env.LOG_ROUTES !== "false") console.log(`[Server] Route /reporting/${type} registered (reports).`);
}
export default router;
