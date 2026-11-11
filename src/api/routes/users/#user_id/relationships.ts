import { route } from "@spacebar/api/middlewares";
import { Relationship, User } from "@spacebar/database";
import { Request, Response, Router } from "express";
import { RelationshipType, UserMutualRelationsResponse } from "@spacebar/schemas";

const router: Router = Router({ mergeParams: true });

const friendIds = async (user_id: string) =>
    new Set((await Relationship.find({ where: { from_id: user_id, type: RelationshipType.FRIEND }, select: { id: true, to_id: true } })).map((row) => row.to_id));

export async function mutualFriendIds(viewer: string, target: string) {
    const [mine, theirs] = await Promise.all([friendIds(viewer), friendIds(target)]);
    const ids = new Set([...mine].filter((id) => theirs.has(id)));
    ids.delete(viewer);
    ids.delete(target);
    return [...ids];
}

router.get(
    "/",
    route({
        description: "Get mutual relationships",
        responses: {
            200: { body: "UserRelationsResponse" },
            404: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const target = await User.findOneOrFail({ where: { id: req.params.user_id as string }, select: { id: true } });
        const ids = await mutualFriendIds(req.user_id, target.id);
        const mutual_relations: UserMutualRelationsResponse = [];
        for (const id of ids) {
            const user = await User.getPublicUser(id);
            mutual_relations.push({ id: user.id, username: user.username, avatar: user.avatar, discriminator: user.discriminator, public_flags: user.public_flags });
        }
        res.json(mutual_relations);
    },
);

export default router;
