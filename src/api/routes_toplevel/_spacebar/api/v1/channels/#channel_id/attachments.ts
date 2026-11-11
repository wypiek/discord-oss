import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { FindOptionsOrderValue, LessThan, MoreThan } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { Attachment, Channel } from "@spacebar/database";
import { FieldErrors, getPermission } from "@spacebar/util";
import { AttachmentListResponse } from "@spacebar/schemas/api/spacebar/AttachmentListResponse";

const router: Router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        responses: {
            200: {
                body: "AttachmentListResponse",
            },
            403: {
                body: "APIErrorResponse",
            },
            422: {
                body: "APIErrorResponse",
            },
        },
        query: {
            sort_order: {
                description: "Sort order for results",
                type: "string",
                values: ["asc", "desc"],
            },
            limit: {
                description: "Max. amount of items to return",
                type: "number",
                default: 50,
            },
            after: {
                description: "Get results after $ATTACHMENT_ID (depends on sort_order)",
                type: "string",
                default: "[start based on sort_order]",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { channel_id } = req.params as { [key: string]: string };
        let { sort_order, limit, after } = req.query as { [key: string]: string };

        const channel = await Channel.findOneOrFail({
            where: { id: channel_id },
        });

        sort_order ??= "desc";
        limit ??= "50";
        after ??= sort_order == "asc" ? "0" : (BigInt(channel.last_message_id ?? "-1") + 1n).toString();
        if (typeof after !== "string" || !/^\d{1,20}$/.test(after)) throw FieldErrors({ after: { message: "Must be a snowflake.", code: "NUMBER_TYPE_COERCE" } });

        const parsedLimit = Number(limit) || 50;
        if (parsedLimit < 1 || parsedLimit > 100) throw new HTTPError("limit must be between 1 and 100", 422);

        if (sort_order) {
            if (typeof sort_order != "string" || ["desc", "asc"].indexOf(sort_order) == -1)
                throw FieldErrors({
                    sort_order: {
                        message: "Value must be one of ('desc', 'asc').",
                        code: "BASE_TYPE_CHOICES",
                    },
                }); // todo this is wrong
        }

        const permissions = await getPermission(req.user_id, channel.guild_id, channel_id as string | undefined);
        permissions.hasThrow("VIEW_CHANNEL");
        if (!permissions.has("READ_MESSAGE_HISTORY")) return res.json({ items: [], total: 0 } satisfies AttachmentListResponse);

        const attCount = Attachment.count({ where: { channel_id: req.params.channel_id as string } });
        const atts = await Attachment.find({
            where: {
                channel_id: req.params.channel_id as string,
                id: (sort_order == "asc" ? MoreThan : LessThan)(after ?? "0"),
            },
            order: {
                id: sort_order as FindOptionsOrderValue,
            },
            take: parsedLimit,
        });

        return res.json({
            items: atts.map((x) => ({
                attachment: x.signUrls({
                    userAgent: req.headers["user-agent"],
                    ip: req.ip,
                }),
                message_reference: {
                    message_id: x.message_id,
                    channel_id: x.channel_id,
                    guild_id: channel.guild_id,
                },
            })),
            total: await attCount,
        } satisfies AttachmentListResponse);
    },
);

export default router;
