import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { User } from "@spacebar/database";
import { broadcastUserUpdate, emitEvent, FieldErrors, UserUpdateEvent } from "@spacebar/util";
import { PrivateUserProjection } from "@spacebar/schemas";
import { assertMaxLength, UserFieldCaps } from "@spacebar/util/util/UserFieldCaps";

const router = Router({ mergeParams: true });

router.post("/", route({}), async (req: Request, res: Response) => {
    const username = String(req.body?.username ?? "");
    assertMaxLength("username", username, UserFieldCaps.username);
    if (!User.isValidPomeloUsername(username))
        throw FieldErrors({
            username: {
                code: "USERNAME_INVALID_CHARACTERS",
                message: "Usernames can only contain letters, numbers, underscores and periods.",
            },
        });
    User.assertUsernameAllowed(username);
    if (await User.isUsernameTaken(username, req.user_id))
        throw FieldErrors({
            username: {
                code: "USERNAME_ALREADY_TAKEN",
                message: "Username is unavailable. Try adding numbers, letters, underscores _ , or periods.",
            },
        });

    const user = await User.findOneOrFail({
        where: { id: req.user_id },
        select: Object.fromEntries(PrivateUserProjection.map((x) => [x, true])),
    });
    if (!user.global_name && user.discriminator !== "0") user.global_name = user.username;
    user.username = username;
    user.discriminator = "0";
    await user.save();

    await emitEvent({
        event: "USER_UPDATE",
        user_id: req.user_id,
        data: user,
    } satisfies UserUpdateEvent);
    await broadcastUserUpdate(req.user_id);
    res.json(user.toPrivateUser());
});

export default router;
