import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { StatusComponent } from "@spacebar/database";
import { AdminStatusComponentSchema } from "@spacebar/schemas";
import { serializeComponent } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

router.get("/", route({ right: "OPERATOR", spacebarOnly: true, description: "List status page components" }), async (req: Request, res: Response) => {
    res.json((await StatusComponent.find({ order: { position: "ASC", id: "ASC" } })).map(serializeComponent));
});

router.post(
    "/",
    route({
        right: "OPERATOR",
        spacebarOnly: true,
        requestBody: "AdminStatusComponentSchema",
        description: "Add a status page component",
    }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminStatusComponentSchema;
        const last = await StatusComponent.findOne({
            where: {},
            order: { position: "DESC" },
            select: { position: true },
        });
        const component = await StatusComponent.create({
            name: body.name.trim(),
            description: body.description?.trim() || null,
            status: body.status ?? "operational",
            position: body.position ?? (last ? last.position + 1 : 0),
        }).save();
        res.status(201).json(serializeComponent(component));
    },
);

export default router;
