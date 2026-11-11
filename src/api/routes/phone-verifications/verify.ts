import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { PhoneVerification } from "@spacebar/api/util";
import { FieldErrors } from "@spacebar/util";

const router = Router({ mergeParams: true });

router.post("/", route({ authentication: "optional", responses: { 200: {}, 400: { body: "APIErrorResponse" } } }), async (req: Request, res: Response) => {
    const { phone, code } = req.body as { phone?: string; code?: string };
    const token = PhoneVerification.verify(PhoneVerification.normalize(phone), code, req.user_id);
    if (!token)
        throw FieldErrors({
            code: { code: "INVALID_PHONE_VERIFICATION_CODE", message: "Invalid verification code" },
        });
    res.json({ token });
});

export default router;
