import { Router, Response, Request } from "express";
import { route } from "@spacebar/api/middlewares";

const router = Router({ mergeParams: true });

router.post(
    "/",
    route({
        spacebarOnly: false, // Not part of the public OpenAPI schema
        authentication: "never",
    }),
    (req: Request, res: Response) => {
        // TODO:
        res.sendStatus(204);
    },
);

export default router;
