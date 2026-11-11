import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";

const router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    res.json({
        guild_verification_role_enabled: false,
        application_identity_linked_roles_enabled: false,
    });
});

export default router;
