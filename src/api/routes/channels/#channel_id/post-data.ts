import { Request, Response, Router } from "express";
import { messageUpload } from "./messages";
import { In } from "typeorm";
import { route, parsePayloadJson } from "@spacebar/api/middlewares";
import { Channel, Member, Message } from "@spacebar/database";
import { PostDataSchema, PublicMember, PublicMessage } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

// TODO: public read receipts & privacy scoping
// TODO: send read state event to all channel members
// TODO: advance-only notification cursor

router.post(
    "/",
    messageUpload.any(),
    parsePayloadJson,
    route({
        requestBody: "PostDataSchema",
        permission: "VIEW_CHANNEL",
        responses: {
            200: {},
            403: {},
        },
    }),
    async (req: Request, res: Response) => {
        const { channel_id } = req.params as Record<string, string>;
        const ids = [...new Set((req.body as PostDataSchema).thread_ids ?? [])].slice(0, 100);
        const threads = await Channel.find({ where: { id: In(ids), parent_id: channel_id } });
        const guild_id = threads[0]?.guild_id;
        const lastIds = threads.map((t) => t.last_message_id).filter((id): id is string => !!id && !ids.includes(id));
        const relations = {
            author: true,
            attachments: true,
            sticker_items: true,
            mentions: true,
            mention_roles: true,
            mention_channels: true,
            webhook: true,
        } as const;
        const [firstMessages, lastMessages, owners] = await Promise.all([
            Message.find({ where: { id: In(threads.map((t) => t.id)) }, relations }),
            lastIds.length ? Message.find({ where: { id: In(lastIds) }, relations }) : Promise.resolve([] as Message[]),
            guild_id
                ? Member.find({
                      where: {
                          guild_id,
                          id: In([...new Set(threads.map((t) => t.owner_id).filter((id): id is string => !!id))]),
                      },
                      relations: { user: true, roles: true },
                  })
                : Promise.resolve([] as Member[]),
        ]);
        const byId = new Map([...firstMessages, ...lastMessages].map((m) => [m.id, m]));
        const objRet: {
            threads: Record<
                string,
                {
                    first_message: PublicMessage | null;
                    most_recent_message: PublicMessage | null;
                    owner: PublicMember | null;
                }
            >;
        } = { threads: {} };
        for (const thread of threads) {
            const owner = owners.find(({ id }) => id === thread.owner_id);
            const last = thread.last_message_id ? byId.get(thread.last_message_id) : undefined;
            objRet.threads[thread.id] = {
                owner: owner
                    ? {
                          ...owner.toPublicMember(),
                          roles: owner.roles.filter((r) => r.id !== guild_id).map((r) => r.id),
                      }
                    : null,
                first_message: byId.get(thread.id)?.toPublicJSON(req.user_id) ?? null,
                most_recent_message: last && last.id !== thread.id ? last.toPublicJSON(req.user_id) : null,
            };
        }
        return res.json(objRet);
    },
);

export default router;
