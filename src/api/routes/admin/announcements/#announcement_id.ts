import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { Announcement, AnnouncementMessage, getDatabase, Message } from "@spacebar/database";
import { Snowflake, trackBackground } from "@spacebar/util";
import { deleteAnnouncementMessages, getSystemAccount } from "@spacebar/api/util";

import { removeAnnouncementSpool } from "@spacebar/api/util/utility/announcementDelivery";

const router = Router({ mergeParams: true });
// announcements sent before their dms were recorded: the official account's messages with the same text (plain, or the
// embed they used to be), sent within a day of it
async function untrackedMessages(announcement: Announcement) {
    const official = await getSystemAccount("official");
    const since = Number(announcement.created_at) - 60_000;
    const range = (ms: number) => ((BigInt(ms) - BigInt(Snowflake.EPOCH)) << 22n).toString();
    return Message.createQueryBuilder("m")
        .select(["m.id", "m.channel_id"])
        .where("m.author_id = :author", { author: official.id })
        .andWhere("m.id BETWEEN :from AND :to", {
            from: range(since),
            to: range(since + 24 * 60 * 60_000),
        })
        .andWhere(`(m.content = :body OR (m.embeds -> 0 ->> 'description' = :body AND COALESCE(m.embeds -> 0 ->> 'title', '') = :title))`, {
            body: announcement.body,
            title: announcement.title ?? "",
        })
        .getMany();
}

router.delete(
    "/",
    route({
        right: "OPERATOR",
        spacebarOnly: true,
        description: "Delete an announcement and take back every dm it was sent as, with their attachments",
        responses: { 204: {} },
    }),
    async (req: Request, res: Response) => {
        const database = getDatabase();
        if (!database) throw new Error("Database unavailable");
        const { announcement, messages } = await database.transaction(async (manager) => {
            const announcement = await manager.getRepository(Announcement).findOneOrFail({
                where: { id: req.params.announcement_id as string },
                lock: { mode: "pessimistic_write" },
            });
            const tracked = await manager.getRepository(AnnouncementMessage).find({ where: { announcement_id: announcement.id } });
            const messages = tracked.length
                ? tracked.map((m) => ({ id: m.message_id, channel_id: m.channel_id }))
                : announcement.durable
                  ? []
                  : await untrackedMessages(announcement);
            await manager.getRepository(Announcement).delete({ id: announcement.id });
            return { announcement, messages };
        });
        await removeAnnouncementSpool(announcement.id);
        trackBackground(
            deleteAnnouncementMessages(messages)
                .then(() => console.log(`[Announcement] User ${req.user_id} deleted announcement ${announcement.id} and its ${messages.length} messages`))
                .catch((e) => console.error(`[Announcement] couldn't delete the messages of ${announcement.id}`, e)),
        );

        res.sendStatus(204);
    },
);

export default router;
