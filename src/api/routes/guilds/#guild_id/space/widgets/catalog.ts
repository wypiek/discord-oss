import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { guildSpaceCatalog } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

router.get("/", route({ permission: "MANAGE_GUILD" }), async (req: Request, res: Response) => {
    res.json(guildSpaceCatalog());
});

export default router;
