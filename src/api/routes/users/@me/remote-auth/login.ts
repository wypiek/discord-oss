import crypto from "node:crypto";
import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { ResponseError, readTicket } from "@spacebar/api/util";
import { User } from "@spacebar/database";
import { generateCompactToken } from "@spacebar/util";

const router = Router({ mergeParams: true });

const used = new Map<string, number>();

router.post("/", route({ authentication: "never", spacebarOnly: false }), async (req: Request, res: Response) => {
    const ticket = req.body?.ticket;
    const decoded = readTicket<{ typ: string; uid?: string; pk?: string; exp?: number }>(ticket, "ra_login");
    if (!decoded?.uid || !decoded.pk || used.has(ticket)) throw new ResponseError(400, { message: "Invalid remote auth ticket", code: 10061 });

    const now = Date.now();
    for (const [key, exp] of used) if (exp < now) used.delete(key);
    used.set(ticket, (decoded.exp ?? 0) * 1000);

    const user = await User.findOne({
        where: { id: decoded.uid },
        select: { id: true, disabled: true, deleted: true },
    });
    if (!user || user.disabled || user.deleted) throw new ResponseError(400, { message: "Invalid remote auth ticket", code: 10061 });

    const key = crypto.createPublicKey({
        key: Buffer.from(decoded.pk, "base64"),
        format: "der",
        type: "spki",
    });
    const token = await generateCompactToken(user.id);
    const encrypted_token = crypto.publicEncrypt({ key, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(token)).toString("base64");

    res.json({ encrypted_token });
});

export default router;
