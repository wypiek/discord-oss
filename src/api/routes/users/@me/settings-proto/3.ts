import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { SettingsProtoResponse } from "@spacebar/schemas";

const router: Router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        responses: {
            200: {
                body: "SettingsProtoResponse",
            },
        },
        spacebarOnly: false,
    }),
    (req: Request, res: Response) => {
        res.json({ settings: "" } satisfies SettingsProtoResponse);
    },
);

router.patch(
    "/",
    route({
        requestBody: "SettingsProtoUpdateSchema",
        responses: {
            200: {
                body: "SettingsProtoUpdateResponse",
            },
        },
        spacebarOnly: false,
    }),
    (req: Request, res: Response) => {
        res.json({ settings: "", out_of_date: false });
    },
);

export default router;
