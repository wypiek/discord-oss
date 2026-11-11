import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { PhoneVerification } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

router.post("/", route({ responses: { 204: {}, 400: { body: "APIErrorResponse" } } }), async (req: Request, res: Response) => {
    PhoneVerification.send(PhoneVerification.normalize((req.body as { phone?: string })?.phone), req.user_id);
    res.sendStatus(204);
});

export default router;
