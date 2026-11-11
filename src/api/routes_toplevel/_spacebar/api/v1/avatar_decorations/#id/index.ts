import { Router, Response, Request } from "express";
import { route } from "@spacebar/api/middlewares";
import { AvatarDecoration } from "@spacebar/database";
import { PublicAvatarDecorationResponse, UpdateAvatarDecorationSchema } from "@spacebar/schemas/api/spacebar/AvatarDecorations";
import { ApiError } from "@spacebar/util";

const router = Router({ mergeParams: true });

router.patch(
    "/",
    route({
        spacebarOnly: true,
        description: "Get available avatar decorations",
        requestBody: "UpdateAvatarDecorationSchema",
        responses: {
            200: {
                body: "PublicAvatarDecorationListResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const changes = req.body as UpdateAvatarDecorationSchema;
        const deco = await AvatarDecoration.findOneOrFail({ where: { id: req.params.id as string } });

        if (deco.uploader_id !== req.user_id) throw new ApiError("You do not have permission to update this avatar decoration", 0, 403);

        if (changes.public !== undefined) deco.public = changes.public;
        if (changes.allowed_user_ids) {
            if (changes.allowed_user_ids.add) deco.allowed_user_ids.push(...changes.allowed_user_ids.add);
            if (changes.allowed_user_ids.remove) deco.allowed_user_ids = deco.allowed_user_ids.filter((x) => !changes.allowed_user_ids!.remove!.includes(x));
        }
        if (changes.allowed_guild_ids) {
            if (changes.allowed_guild_ids.add) deco.allowed_user_ids.push(...changes.allowed_guild_ids.add);
            if (changes.allowed_guild_ids.remove) deco.allowed_user_ids = deco.allowed_user_ids.filter((x) => !changes.allowed_guild_ids!.remove!.includes(x));
        }
        if (changes.allowed_role_ids) {
            if (changes.allowed_role_ids.add) deco.allowed_user_ids.push(...changes.allowed_role_ids.add);
            if (changes.allowed_role_ids.remove) deco.allowed_user_ids = deco.allowed_user_ids.filter((x) => !changes.allowed_role_ids!.remove!.includes(x));
        }

        // TODO: remove avatar from users that no longer have access to them

        res.json(deco.toPublicAvatarDecoration() satisfies PublicAvatarDecorationResponse);
    },
);

export default router;
