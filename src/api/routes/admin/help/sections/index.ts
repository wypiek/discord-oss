import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { HelpCategory, HelpSection } from "@spacebar/database";
import { applyOrder, helpCentreTree, serializeHelpSection } from "@spacebar/api/util";
import { Snowflake } from "@spacebar/util";
import { AdminHelpSectionCreateSchema, AdminSiteOrderSchema } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

router.post(
    "/",
    route({ right: "OPERATOR", spacebarOnly: true, requestBody: "AdminHelpSectionCreateSchema", description: "Add a section to a help centre category" }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminHelpSectionCreateSchema;
        if (!(await HelpCategory.findOne({ where: { id: body.category_id }, select: { id: true } }))) throw new HTTPError("Unknown help centre category", 400);
        const section = await HelpSection.create({
            id: Snowflake.generate(),
            category_id: body.category_id,
            name: body.name.trim(),
            position: await HelpSection.count({ where: { category_id: body.category_id } }),
        }).save();
        res.status(201).json(serializeHelpSection(section));
    },
);

router.patch(
    "/",
    route({
        right: "OPERATOR",
        spacebarOnly: true,
        requestBody: "AdminSiteOrderSchema",
        description: "Reorder the sections of one category. Every id must belong to the same category.",
    }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminSiteOrderSchema;
        const first = await HelpSection.findOne({ where: { id: body.ids[0] } });
        if (!first) throw new HTTPError("Unknown help centre section", 400);
        await applyOrder(await HelpSection.find({ where: { category_id: first.category_id } }), body.ids);
        res.json(await helpCentreTree());
    },
);

export default router;
