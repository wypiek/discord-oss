import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { HelpArticle, HelpCategory, HelpSection } from "@spacebar/database";
import { serializeHelpSection } from "@spacebar/api/util";
import { AdminHelpSectionUpdateSchema } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

const findSection = async (req: Request) => {
    const section = await HelpSection.findOne({ where: { id: req.params.section_id as string } });
    if (!section) throw new HTTPError("Unknown help centre section", 404);
    return section;
};

router.patch(
    "/",
    route({ right: "OPERATOR", spacebarOnly: true, requestBody: "AdminHelpSectionUpdateSchema", description: "Rename a section or move it to another category" }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminHelpSectionUpdateSchema;
        const section = await findSection(req);
        if (body.name !== undefined) {
            if (!body.name.trim()) throw new HTTPError("A section needs a name", 400);
            section.name = body.name.trim();
        }
        if (body.category_id !== undefined && body.category_id !== section.category_id) {
            if (!(await HelpCategory.findOne({ where: { id: body.category_id }, select: { id: true } }))) throw new HTTPError("Unknown help centre category", 400);
            section.category_id = body.category_id;
            section.position = await HelpSection.count({ where: { category_id: body.category_id } });
        }
        await section.save();
        res.json(serializeHelpSection(section));
    },
);

router.delete(
    "/",
    route({ right: "OPERATOR", spacebarOnly: true, description: "Delete a section and its articles", responses: { 204: {} } }),
    async (req: Request, res: Response) => {
        const section = await findSection(req);
        await HelpArticle.delete({ section_id: section.id });
        await HelpSection.delete({ id: section.id });
        res.sendStatus(204);
    },
);

export default router;
