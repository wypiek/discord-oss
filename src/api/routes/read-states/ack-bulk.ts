import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { ReadState } from "@spacebar/database";
import { AckBulkSchema } from "@spacebar/schemas";
import { emitEvent, MessageAckEvent } from "@spacebar/util";

const router = Router({ mergeParams: true });

router.post(
    "/",
    route({
        requestBody: "AckBulkSchema",
        responses: {
            204: {},
            400: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const body = req.body as AckBulkSchema;

        // TODO: what is read_state_type ?

        await Promise.all([
            // for every new state
            ...body.read_states.map(async (x) => {
                // find an existing one
                const ret =
                    (await ReadState.findOne({
                        where: {
                            user_id: req.user_id,
                            channel_id: x.channel_id,
                        },
                    })) ??
                    // if it doesn't exist, create it (not a promise)
                    ReadState.create({
                        user_id: req.user_id,
                        channel_id: x.channel_id,
                    });

                ret.last_message_id = x.message_id;
                //It's a little more complicated than this but this'll do
                ret.mention_count = 0;

                await ret.save();
                await emitEvent({
                    event: "MESSAGE_ACK",
                    user_id: req.user_id,
                    data: { channel_id: x.channel_id, message_id: x.message_id, version: Date.now() },
                } satisfies MessageAckEvent);
            }),
        ]);

        return res.sendStatus(204);
    },
);

export default router;
