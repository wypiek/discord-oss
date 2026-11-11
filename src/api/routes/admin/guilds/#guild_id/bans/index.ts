import { Request, Response, Router } from "express";
import { In } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { cursorLimit, cursorPage, likePattern, searchText, snowflakeCursor } from "@spacebar/api/util";
import { Ban, Guild, User } from "@spacebar/database";
import { sqlLike } from "@spacebar/database/Sql";

const router = Router({ mergeParams: true });

const summary = (user: User | undefined, id: string) =>
    user
        ? { id: user.id, username: user.username, discriminator: user.discriminator, global_name: user.global_name ?? null, avatar: user.avatar ?? null }
        : { id, username: null, discriminator: null, global_name: null, avatar: null };

router.get(
    "/",
    route({
        right: "MANAGE_GUILDS",
        spacebarOnly: true,
        description: "List a server's bans by banned user id with who banned them and why. Pass `next` from a page as `after` to read the next one",
        query: {
            q: { type: "string", required: false, description: "An exact user id or part of a username or display name" },
            after: { type: "string", required: false },
            limit: { type: "number", required: false, description: "1 to 100, 50 by default" },
        },
    }),
    async (req: Request, res: Response) => {
        const guild_id = req.params.guild_id as string;
        const q = searchText(req.query.q);
        const after = snowflakeCursor(req.query.after, "after");
        const limit = cursorLimit(req.query.limit, 50, 100);
        await Guild.findOneOrFail({ where: { id: guild_id }, select: { id: true } });

        const query = Ban.createQueryBuilder("ban")
            .innerJoin("ban.user", "user")
            .select(["ban.id", "ban.user_id", "ban.executor_id", "ban.reason"])
            .addSelect(["user.id", "user.username", "user.discriminator", "user.global_name", "user.avatar"])
            .where("ban.guild_id = :guild_id", { guild_id })
            .andWhere("ban.user_id IS DISTINCT FROM ban.executor_id")
            .orderBy("ban.user_id", "ASC")
            .limit(limit + 1);
        if (after) query.andWhere("ban.user_id > :after", { after });
        if (/^\d{15,20}$/.test(q)) query.andWhere("ban.user_id = :exact", { exact: q });
        else if (q) query.andWhere(`(${sqlLike("user.username", ":q")} OR ${sqlLike("user.global_name", ":q")})`, { q: likePattern(q) });

        const [rows, total] = await Promise.all([
            query.getMany(),
            q ? null : Ban.createQueryBuilder("ban").where("ban.guild_id = :guild_id", { guild_id }).andWhere("ban.user_id IS DISTINCT FROM ban.executor_id").getCount(),
        ]);
        const { page, next } = cursorPage(rows, limit, (ban) => ban.user_id);
        const executorIds = [...new Set(page.map((ban) => ban.executor_id).filter((id): id is string => !!id))];
        const executors = executorIds.length
            ? await User.find({ where: { id: In(executorIds) }, select: { id: true, username: true, discriminator: true, global_name: true, avatar: true } })
            : [];

        res.json({
            total,
            next,
            bans: page.map((ban) => ({
                user: summary(ban.user, ban.user_id),
                reason: ban.reason ?? null,
                executor: ban.executor_id
                    ? summary(
                          executors.find((user) => user.id === ban.executor_id),
                          ban.executor_id,
                      )
                    : null,
            })),
        });
    },
);

export default router;
