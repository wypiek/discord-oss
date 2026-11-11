import { Request, Response, Router } from "express";
import { In } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { Channel, Recipient } from "@spacebar/database";
import { ChannelDeleteEvent, DmChannelDTO, emitEvent } from "@spacebar/util";
import { ChannelType } from "@spacebar/schemas";

const router: Router = Router({ mergeParams: true });

router.put(
    "/",
    route({
        responses: {
            204: {},
        },
    }),
    async (req: Request, res: Response) => {
        const ids = (Array.isArray(req.body?.channel_ids) ? req.body.channel_ids : []).map(String).slice(0, 100);
        const recipients = ids.length
            ? await Recipient.find({
                  where: { user_id: req.user_id, channel_id: In(ids) },
                  relations: { channel: { recipients: true } },
              })
            : [];
        for (const recipient of recipients.filter((r) => r.channel.type === ChannelType.DM)) {
            recipient.closed = true;
            recipient.message_request_timestamp = null;
            await Recipient.update({ id: recipient.id }, { closed: true, message_request_timestamp: null });
            await emitEvent({
                event: "CHANNEL_DELETE",
                data: await DmChannelDTO.from(recipient.channel as Channel, [req.user_id]),
                user_id: req.user_id,
            } as ChannelDeleteEvent);
        }
        res.sendStatus(204);
    },
);

export default router;
