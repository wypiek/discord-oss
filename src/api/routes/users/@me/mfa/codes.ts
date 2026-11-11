import bcrypt from "bcrypt";
import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { requireMfa } from "@spacebar/api/util";
import { BackupCode, generateMfaBackupCodes, User } from "@spacebar/database";
import { FieldErrors } from "@spacebar/util";
import { MfaCodesSchema } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

// TODO: This route is replaced with users/@me/mfa/codes-verification in newer clients

router.post(
    "/",
    route({
        requestBody: "MfaCodesSchema",
        deprecated: true,
        description: "This route is replaced with users/@me/mfa/codes-verification in newer clients",
        responses: {
            200: {
                body: "BackupCodeArray",
            },
            400: {
                body: "APIErrorResponse",
            },
            404: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { password, regenerate } = req.body as MfaCodesSchema;

        const user = await User.findOneOrFail({
            where: { id: req.user_id },
            select: { data: true },
        });

        if (!(await bcrypt.compare(password, user.data.hash || ""))) {
            throw FieldErrors({
                password: {
                    message: req.t("auth:login.INVALID_PASSWORD"),
                    code: "INVALID_PASSWORD",
                },
            });
        }
        await requireMfa(req);

        let codes: BackupCode[];
        if (regenerate) {
            await BackupCode.update({ user: { id: req.user_id } }, { expired: true });

            codes = generateMfaBackupCodes(req.user_id);
            await Promise.all(codes.map((x) => x.save()));
        } else {
            codes = await BackupCode.find({
                where: {
                    user: {
                        id: req.user_id,
                    },
                    expired: false,
                },
            });
        }

        return res.json({
            backup_codes: codes.map((x) => ({ ...x, expired: undefined })),
        });
    },
);

export default router;
