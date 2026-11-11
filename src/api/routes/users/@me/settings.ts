import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { UserSettings, UserSettingsProtos } from "@spacebar/database";
import { UserSettingsUpdateSchema } from "@spacebar/schemas";
import { updateUserPreferenceSettings } from "@spacebar/api/util/handlers/UserPreferenceSettings";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        responses: {
            200: {
                body: "UserSettings",
            },
            404: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const [settings, protos] = await Promise.all([UserSettings.getOrDefault(req.user_id), UserSettingsProtos.getOrDefault(req.user_id)]);
        return res.json(settings.toLegacy(protos.userSettings));
    },
);

router.patch(
    "/",
    route({
        requestBody: "UserSettingsUpdateSchema",
        responses: {
            200: {
                body: "UserSettings",
            },
            400: {
                body: "APIErrorResponse",
            },
            404: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        if (!req.body) return res.status(400).json({ code: 400, message: "Invalid request body" });
        res.json(await updateUserPreferenceSettings(req.user_id, req.body as UserSettingsUpdateSchema));
    },
);

export default router;
