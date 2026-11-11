import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { canActOn, cursorLimit, cursorPage, likePattern, searchText, snowflakeCursor } from "@spacebar/api/util";
import { Guild, Member } from "@spacebar/database";
import { sqlLike } from "@spacebar/database/Sql";
import { loadStaffRoles } from "@spacebar/util";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        right: "MANAGE_GUILDS",
        spacebarOnly: true,
        description:
            "List or search a server's members, oldest account first. `q` matches an exact user id or part of a username, display name or nickname. Pass `next` from a page as `after` to read the next one",
        query: {
            q: { type: "string", required: false },
            after: { type: "string", required: false, description: "Return members whose user id is greater than this one" },
            limit: { type: "number", required: false, description: "1 to 100, 50 by default" },
        },
    }),
    async (req: Request, res: Response) => {
        const guild_id = req.params.guild_id as string;
        const q = searchText(req.query.q);
        const after = snowflakeCursor(req.query.after, "after");
        const limit = cursorLimit(req.query.limit, 50, 100);
        const guild = await Guild.findOneOrFail({ where: { id: guild_id }, select: { id: true, owner_id: true, federated_instance: true } });

        const ids = Member.createQueryBuilder("member")
            .innerJoin("member.user", "user")
            .select("member.id", "id")
            .where("member.guild_id = :guild_id", { guild_id })
            .orderBy("member.id", "ASC")
            .limit(limit + 1);
        if (after) ids.andWhere("member.id > :after", { after });
        if (/^\d{15,20}$/.test(q)) ids.andWhere("member.id = :exact", { exact: q });
        else if (q)
            ids.andWhere(`(${sqlLike("user.username", ":q")} OR ${sqlLike("user.global_name", ":q")} OR ${sqlLike("member.nick", ":q")})`, {
                q: likePattern(q),
            });

        const { page, next } = cursorPage(
            (await ids.getRawMany<{ id: string }>()).map((row) => String(row.id)),
            limit,
            (id) => id,
        );
        const [members, total, snap] = await Promise.all([
            page.length
                ? Member.createQueryBuilder("member")
                      .innerJoin("member.user", "user")
                      .leftJoin("member.roles", "role")
                      .select(["member.index", "member.id", "member.nick", "member.joined_at", "member.communication_disabled_until", "member.pending", "role.id"])
                      .addSelect(["user.id", "user.username", "user.discriminator", "user.global_name", "user.avatar", "user.bot", "user.rights", "user.federated_instance"])
                      .where("member.guild_id = :guild_id", { guild_id })
                      .andWhere("member.id IN (:...page)", { page })
                      .orderBy("member.id", "ASC")
                      .getMany()
                : [],
            q ? null : Member.count({ where: { guild_id } }),
            loadStaffRoles(),
        ]);
        const actor = { id: req.user_id, rights: req.rights.bitfield };

        res.json({
            total,
            next,
            members: members.map((member) => ({
                id: member.id,
                user: {
                    id: member.user.id,
                    username: member.user.username,
                    discriminator: member.user.discriminator,
                    global_name: member.user.global_name ?? null,
                    avatar: member.user.avatar ?? null,
                    bot: member.user.bot,
                    federated_instance: member.user.federated_instance ?? null,
                },
                nick: member.nick ?? null,
                roles: member.roles.map((role) => role.id).filter((id) => id !== guild_id),
                joined_at: member.joined_at,
                pending: member.pending,
                communication_disabled_until:
                    member.communication_disabled_until && member.communication_disabled_until.getTime() > Date.now() ? member.communication_disabled_until.toISOString() : null,
                owner: guild.owner_id === member.id,
                protected: !canActOn(actor, member.user, snap),
            })),
        });
    },
);

export default router;
