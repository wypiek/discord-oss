import { route } from "@spacebar/api/middlewares";
import { User } from "@spacebar/database";
import { Request, Response, Router } from "express";

const router: Router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        responses: {
            200: {
                body: "PublicUser",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { user_id } = req.params as { [key: string]: string };

        res.json(await User.getPublicUser(user_id));
    },
);

export default router;
