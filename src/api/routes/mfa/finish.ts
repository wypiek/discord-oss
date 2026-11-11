import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { MfaInvalidCode, MfaInvalidTicket, guardedMfaAttempt, issueRecentMfa, readTicket, verifyMfaMethod } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

router.post("/", route({ spacebarOnly: false }), async (req: Request, res: Response) => {
    const { ticket, mfa_type, data } = req.body as {
        ticket?: string;
        mfa_type?: string;
        data?: string;
    };
    const decoded = readTicket(ticket, "mfa");
    if (!decoded?.uid || decoded.uid !== req.user_id) throw MfaInvalidTicket();
    if (!mfa_type || !(await guardedMfaAttempt(ticket!, () => verifyMfaMethod(decoded.uid!, mfa_type, data, decoded)))) {
        if (mfa_type === "password")
            return res.status(400).json({
                message: "Password does not match.",
                code: 50035,
                errors: {
                    data: {
                        _errors: [{ code: "PASSWORD_DOES_NOT_MATCH", message: "Password does not match." }],
                    },
                },
            });
        throw MfaInvalidCode();
    }
    res.json({ token: issueRecentMfa(res, decoded.uid) });
});

export default router;
