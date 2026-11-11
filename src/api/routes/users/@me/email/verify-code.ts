import { route } from "@spacebar/api/middlewares";
import { EmailChange } from "@spacebar/api/util";
import { FieldErrors } from "@spacebar/util";
import { Request, Response, Router } from "express";

const router = Router({ mergeParams: true });

router.post("/", route({}), async (req: Request, res: Response) => {
    const code = String(req.body?.code ?? "");
    const token = EmailChange.verifyCode(req.user_id, code);
    if (!token)
        throw FieldErrors({
            code: { code: "INVALID_EMAIL_VERIFICATION_CODE", message: "Invalid verification code" },
        });
    res.json({ token });
});

export default router;
