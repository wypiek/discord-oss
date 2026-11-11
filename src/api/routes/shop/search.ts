import { route } from "@spacebar/api/middlewares";
import { Request, Response, Router } from "express";
import { Collectibles } from "@spacebar/util";

const router = Router({ mergeParams: true });

const list = (value: unknown) =>
    [value]
        .flat()
        .flatMap((x) => (typeof x === "string" ? x.split(",") : []))
        .filter(Boolean);
const number = (value: unknown) => (typeof value === "string" && /^\d+$/.test(value) ? Number(value) : undefined);

// the shop's browse tabs and search box
router.get("/", route({ responses: { 200: {} } }), async (req: Request, res: Response) => {
    const { item_types, search, sort_type, sort_direction, offset, limit, is_first_party } = req.query;
    res.json(
        await Collectibles.search({
            item_types: list(item_types),
            search: typeof search === "string" ? search.slice(0, 100) : undefined,
            sort_type: typeof sort_type === "string" ? sort_type : undefined,
            sort_direction: typeof sort_direction === "string" ? sort_direction : undefined,
            offset: number(offset),
            limit: number(limit),
            first_party: is_first_party === "false" ? false : undefined,
        }),
    );
});

export default router;
