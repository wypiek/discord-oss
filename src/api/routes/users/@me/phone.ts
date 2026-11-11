import bcrypt from "bcrypt";
import { Request, Response, Router } from "express";
import { Not } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { PhoneVerification, emitUserUpdate, passwordMismatch, setSmsFlag } from "@spacebar/api/util";
import { User } from "@spacebar/database";
import { FieldErrors } from "@spacebar/util";

const router = Router({ mergeParams: true });

const checkPassword = async (user_id: string, password: unknown) => {
    const user = await User.findOneOrFail({
        where: { id: user_id },
        select: { id: true, data: true },
    });
    if (user.data?.hash && !(typeof password === "string" && (await bcrypt.compare(password, user.data.hash)))) throw passwordMismatch();
};

router.post("/", route({ responses: { 204: {}, 400: { body: "APIErrorResponse" } } }), async (req: Request, res: Response) => {
    const { phone, phone_token, password } = req.body as {
        phone?: string;
        phone_token?: string;
        password?: string;
    };

    if (phone !== undefined) {
        PhoneVerification.send(PhoneVerification.normalize(phone), req.user_id);
        return res.sendStatus(204);
    }

    const verified = PhoneVerification.readToken(phone_token, req.user_id);
    if (!verified)
        throw FieldErrors({
            phone_token: { code: "PHONE_TOKEN_INVALID", message: "Invalid phone verification token" },
        });
    await checkPassword(req.user_id, password);

    const previous = await User.find({
        where: { phone: verified, id: Not(req.user_id) },
        select: { id: true },
    });
    await User.update({ id: req.user_id }, { phone: verified });
    for (const other of previous) {
        await User.update({ id: other.id }, { phone: null });
        await setSmsFlag(other.id, false);
        await emitUserUpdate(other.id);
    }
    await emitUserUpdate(req.user_id);
    res.sendStatus(204);
});

router.delete("/", route({ responses: { 204: {}, 400: { body: "APIErrorResponse" } } }), async (req: Request, res: Response) => {
    await checkPassword(req.user_id, (req.body as { password?: string })?.password);
    await User.update({ id: req.user_id }, { phone: null });
    await setSmsFlag(req.user_id, false);
    await emitUserUpdate(req.user_id);
    res.sendStatus(204);
});

export default router;
