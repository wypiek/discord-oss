import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { toOwnedApplication } from "@spacebar/api/util/handlers/Application";
import { Application } from "@spacebar/database";
import { handleFile } from "@spacebar/util";
import { ApplicationModifySchema } from "@spacebar/schemas";

const router: Router = Router({ mergeParams: true });

// TODO: actually make this be correct - this is just a copy paste of /applications/:id/index.ts minus delete
router.get(
    "/",
    route({
        responses: {
            200: {
                body: "Application",
            },
            400: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const app = await Application.findOneOrFail({
            where: { id: req.user_id },
            relations: { owner: true, bot: true },
        });

        return res.json(toOwnedApplication(app));
    },
);

router.patch(
    "/",
    route({
        requestBody: "ApplicationModifySchema",
        responses: {
            200: {
                body: "Application",
            },
            400: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const body = req.body as ApplicationModifySchema;
        const ownerOnly = Object.keys(body).find((key) => !["description", "icon", "cover_image", "tags"].includes(key));
        if (ownerOnly) throw new HTTPError(`${ownerOnly} can only be changed by the application's owner`, 403);

        const app = await Application.findOneOrFail({
            where: { id: req.user_id },
            relations: { owner: true, bot: true },
        });

        if (body.icon) {
            body.icon = await handleFile(`/app-icons/${app.id}`, body.icon as string);
        }
        if (body.cover_image) {
            body.cover_image = await handleFile(`/app-icons/${app.id}`, body.cover_image as string);
        }

        if (body.tags) {
            body.tags = [...new Set(body.tags.map((tag) => tag.trim()).filter(Boolean))];
            if (body.tags.some((tag) => tag.length > 20)) throw new HTTPError("Tags can be up to 20 characters long", 400);
        }

        if (app.bot && body.description !== undefined) {
            app.bot.assign({ bio: body.description });
            await app.bot.save();
        }

        app.assign(body);
        if (body.tags !== undefined) app.tags = body.tags;

        await app.save();

        return res.json(toOwnedApplication(app));
    },
);

export default router;
