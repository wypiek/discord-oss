import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { User } from "@spacebar/database";
import { emitEvent, handleFile, UserUpdateEvent } from "@spacebar/util";
import { AdminOfficialAccountUpdateSchema, PrivateUserProjection } from "@spacebar/schemas";
import { getSystemAccount, serializeOfficial } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

// nobody can sign in as the official account, so its profile picture is set from here
router.patch(
    "/",
    route({
        right: "OPERATOR",
        spacebarOnly: true,
        requestBody: "AdminOfficialAccountUpdateSchema",
        description: "Change the profile picture of the official account announcements come from",
    }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminOfficialAccountUpdateSchema;
        const official = await getSystemAccount("official");

        if (body.avatar !== undefined) {
            const avatar = body.avatar ? await handleFile(`/avatars/${official.id}`, body.avatar) : null;
            if (body.avatar && !avatar) throw new HTTPError("avatar must be a data: URI image", 400);
            // null puts the default picture back
            await User.update({ id: official.id }, { avatar: avatar as string });
        }

        const updated = await User.findOneOrFail({
            where: { id: official.id },
            select: Object.fromEntries(PrivateUserProjection.map((key) => [key, true])),
        });
        await emitEvent({
            event: "USER_UPDATE",
            user_id: official.id,
            data: updated,
        } satisfies UserUpdateEvent);
        res.json(serializeOfficial(updated));
    },
);

export default router;
