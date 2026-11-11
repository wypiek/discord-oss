import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { MfaInvalidCode, ResponseError, emitUserUpdate, freshBackupCodes, requireMfa, restartOtherSessions, serializeBackupCodes, verifyTotp } from "@spacebar/api/util";
import { User } from "@spacebar/database";

const router = Router({ mergeParams: true });

router.post(
    "/",
    route({
        responses: {
            200: {
                body: "TokenWithBackupCodesResponse",
            },
            400: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { password, secret, code } = req.body as {
            password?: string;
            secret?: string;
            code?: string;
        };

        const user = await User.findOneOrFail({
            where: { id: req.user_id },
            select: { id: true, mfa_enabled: true, totp_secret: true },
        });
        if (user.mfa_enabled && user.totp_secret) throw new ResponseError(400, { message: "Two factor is already enabled.", code: 60001 });

        await requireMfa(req, { password });

        if (!secret || !/^[A-Z2-7]{16,64}$/i.test(secret)) throw new ResponseError(400, { message: "Invalid two-factor secret", code: 60005 });
        if (!verifyTotp(secret, code)) throw MfaInvalidCode();

        await User.update({ id: req.user_id }, { mfa_enabled: true, totp_secret: secret.toUpperCase() });
        const codes = await freshBackupCodes(req.user_id);
        const token = await restartOtherSessions(req);
        await emitUserUpdate(req.user_id);

        res.json({
            token,
            backup_codes: serializeBackupCodes(req.user_id, codes),
        });
    },
);

export default router;
