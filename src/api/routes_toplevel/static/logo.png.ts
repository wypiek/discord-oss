import { Router, Response, Request } from "express";
import { route } from "@spacebar/api/middlewares";
import { DEFAULT_ICON_FILE, instanceIcon, sendBrandImage } from "@spacebar/util";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        spacebarOnly: true,
        authentication: "never",
    }),
    (req: Request, res: Response) => sendBrandImage(res, instanceIcon() ?? { file: DEFAULT_ICON_FILE }),
);

export default router;
