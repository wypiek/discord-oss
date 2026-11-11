import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { MfaInvalidTicket, PhoneVerification, ResponseError, readTicket, redactPhone, smsPhone } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

router.post("/", route({ authentication: "never", spacebarOnly: false }), async (req: Request, res: Response) => {
    const { ticket } = req.body as { ticket?: string };
    const decoded = readTicket(ticket, "login") ?? readTicket(ticket, "mfa");
    if (!decoded?.uid) throw MfaInvalidTicket();
    const phone = await smsPhone(decoded.uid);
    if (!phone) throw new ResponseError(400, { message: "SMS authentication is not enabled.", code: 60002 });
    PhoneVerification.send(phone, decoded.uid);
    res.json({ phone: redactPhone(phone) });
});

export default router;
