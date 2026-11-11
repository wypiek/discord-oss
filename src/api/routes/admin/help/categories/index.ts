import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { HelpCategory } from "@spacebar/database";
import { applyOrder, helpCentreTree, resolveSlug, serializeHelpCategory, siteImageField } from "@spacebar/api/util";
import { Snowflake } from "@spacebar/util";
import { AdminHelpCategoryCreateSchema, AdminSiteOrderSchema } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({ right: "OPERATOR", spacebarOnly: true, description: "The whole help centre: categories with their sections and article summaries, in order" }),
    async (req: Request, res: Response) => {
        res.json(await helpCentreTree());
    },
);

router.post(
    "/",
    route({ right: "OPERATOR", spacebarOnly: true, requestBody: "AdminHelpCategoryCreateSchema", description: "Create a help centre category" }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminHelpCategoryCreateSchema;
        const name = body.name.trim();
        const category = await HelpCategory.create({
            id: Snowflake.generate(),
            name,
            slug: await resolveSlug("helpCategory", body.slug, name),
            description: body.description?.trim() ?? "",
            icon: body.icon?.trim() ?? "",
            icon_image: siteImageField(body.icon_image) ?? null,
            position: await HelpCategory.count(),
        }).save();
        res.status(201).json(serializeHelpCategory(category));
    },
);

router.patch(
    "/",
    route({ right: "OPERATOR", spacebarOnly: true, requestBody: "AdminSiteOrderSchema", description: "Reorder help centre categories" }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminSiteOrderSchema;
        await applyOrder(await HelpCategory.find(), body.ids);
        res.json(await helpCentreTree());
    },
);

export default router;
