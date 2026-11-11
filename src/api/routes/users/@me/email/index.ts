import { route } from "@spacebar/api/middlewares";
import { EmailChange } from "@spacebar/api/util";
import { User } from "@spacebar/database";
import { Config, Email } from "@spacebar/util";
import { Request, Response, Router } from "express";

const router = Router({ mergeParams: true });

router.put("/", route({ responses: { 204: {} } }), async (req: Request, res: Response) => {
    const user = await User.findOneOrFail({
        where: { id: req.user_id },
        select: { id: true, username: true, email: true },
    });
    const code = EmailChange.createCode(req.user_id);

    if (!Email.transporter || !user.email) {
        console.log(`[Email] Skipped email change verification delivery for user ${user.id}: email delivery is unavailable`);
        return res.sendStatus(204);
    }

    const text = `Your ${Config.get().general.instanceName} verification code is ${code}. It expires in 10 minutes.`;
    await Email.transporter.sendMail({
        from: Config.get().email.senderAddress || Config.get().general.correspondenceEmail || "noreply@localhost",
        to: user.email,
        subject: `Your verification code is ${code}`,
        text,
        html: `<p>${text}</p>`,
    });
    res.sendStatus(204);
});

export default router;
