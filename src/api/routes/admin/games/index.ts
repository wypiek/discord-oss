import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { CustomGame } from "@spacebar/database";
import { handleFile } from "@spacebar/util";
import { AdminCustomGameCreateSchema } from "@spacebar/schemas";
import { cleanGameAliases, DetectableGames, serializeCustomGame } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        right: "OPERATOR",
        spacebarOnly: true,
        description: "List the games admins added for users to put on their profiles and servers",
    }),
    async (req: Request, res: Response) => {
        const games = await CustomGame.find({ order: { name: "ASC" } });
        res.json(games.map(serializeCustomGame));
    },
);

router.post(
    "/",
    route({
        right: "OPERATOR",
        spacebarOnly: true,
        requestBody: "AdminCustomGameCreateSchema",
        description: "Add a custom game users can pick for their profile and server",
    }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminCustomGameCreateSchema;
        const game = CustomGame.create({
            name: body.name.trim(),
            aliases: cleanGameAliases(body.aliases),
            created_by: req.user_id,
        });
        if (!game.name) throw new HTTPError("A game needs a name", 400);
        // the client loads game art from app-icons/<game id>/<hash>, like discord's own games
        if (body.icon_data && !(game.icon_hash = await handleFile(`/app-icons/${game.id}`, body.icon_data))) throw new HTTPError("icon_data must be a data: URI image", 400);
        if (body.cover_data && !(game.cover_image_hash = await handleFile(`/app-icons/${game.id}`, body.cover_data)))
            throw new HTTPError("cover_data must be a data: URI image", 400);
        await game.save();
        DetectableGames.invalidateCustom();
        res.status(201).json(serializeCustomGame(game));
    },
);

export default router;
