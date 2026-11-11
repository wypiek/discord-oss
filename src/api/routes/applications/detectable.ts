import { route } from "@spacebar/api/middlewares";
import { Request, Response, Router } from "express";
import { DetectableGames } from "@spacebar/api/util";

const router: Router = Router({ mergeParams: true });
router.get(
    "/",
    route({
        responses: {
            200: {
                body: "ApplicationDetectableResponse",
            },
        },
        spacebarOnly: false, // not part of public openapi
    }),
    async (req: Request, res: Response) => {
        const cache = await DetectableGames.load();

        res.set("Cache-Control", `public, max-age=${Math.floor((cache.expires - Date.now()) / 1000)}, s-maxage=${Math.floor((cache.expires - Date.now()) / 1000)}, immutable`)
            .status(200)
            .json(cache.games);
    },
);

export default router;
