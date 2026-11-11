import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { GuildInsights, ReadState } from "@spacebar/database";
import { emitEvent, getPermission, MessageAckEvent } from "@spacebar/util";
import { MessageAcknowledgeSchema } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

// TODO: public read receipts & privacy scoping
// TODO: send read state event to all channel members
// TODO: advance-only notification cursor

router.post(
    "/",
    route({
        requestBody: "MessageAcknowledgeSchema",
        responses: {
            200: {},
            403: {},
        },
    }),
    async (req: Request, res: Response) => {
        const { channel_id, message_id } = req.params as { [key: string]: string };

        const permission = await getPermission(req.user_id, undefined, channel_id, { user: req.user?.id === req.user_id ? req.user : undefined });
        permission.hasThrow("VIEW_CHANNEL");
        GuildInsights.visit(channel_id, req.user_id);

        const body = req.body as MessageAcknowledgeSchema;
        const changes: Partial<Pick<ReadState, "last_message_id" | "mention_count" | "flags">> = {
            last_message_id: message_id,
            mention_count: body.manual ? Math.max(0, body.mention_count ?? 0) : 0,
            ...(body.flags !== undefined && { flags: body.flags as ReadState["flags"] }),
        };
        const read_state = await ReadState.findOne({
            where: { user_id: req.user_id, channel_id },
        });
        if (read_state) await ReadState.update({ id: read_state.id }, changes);
        else await ReadState.create({ user_id: req.user_id, channel_id, ...changes }).save();

        await emitEvent({
            event: "MESSAGE_ACK",
            user_id: req.user_id,
            data: {
                channel_id,
                message_id,
                version: Date.now(),
                ...(body.manual && { manual: true, mention_count: changes.mention_count }),
            },
        } satisfies MessageAckEvent);

        res.json({ token: null });
    },
);

export default router;
