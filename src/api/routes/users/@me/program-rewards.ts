import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { ProgramRewardsResponse } from "@spacebar/schemas";

const router: Router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        responses: {
            200: {
                body: "ProgramRewardsResponse",
            },
        },
        spacebarOnly: false,
    }),
    (req: Request, res: Response) => {
        res.json({ rewards: [] } satisfies ProgramRewardsResponse);
    },
);

export default router;
