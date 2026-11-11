import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { Categories } from "@spacebar/database";

const router = Router({ mergeParams: true });
router.get(
    "/",
    route({
        query: {
            primary_only: {
                type: "boolean",
                default: false,
                required: false,
            },
            locale: {
                type: "string",
                default: "en_US",
                required: false,
            },
        },
        responses: {
            200: {
                body: "APIDiscoveryCategoryArray",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { locale, primary_only } = req.query;

        const out = primary_only ? await Categories.find({ where: { is_primary: true } }) : await Categories.find();

        res.send(out.map((x) => x.toDiscoveryCategory(locale as string | undefined)));
    },
);

export default router;
