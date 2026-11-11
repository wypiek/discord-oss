import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { assertionOptions, requestOrigin, signTicket } from "@spacebar/api/util";

export const passwordlessStart = (mediation?: string) => (req: Request, res: Response) => {
    const origin = requestOrigin(req);
    const { challenge, options } = assertionOptions(origin, [], "required", mediation);
    res.json({
        challenge: options,
        ticket: signTicket({ typ: "passwordless", ch: challenge, origin }),
    });
};

const router = Router({ mergeParams: true });

router.post("/", route({ authentication: "never", spacebarOnly: false }), passwordlessStart("conditional"));

export default router;
