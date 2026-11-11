import { route } from "@spacebar/api/middlewares";
import { createHash } from "node:crypto";
import { Snowflake } from "@spacebar/util";
import { Request, Response, Router } from "express";
const router = Router({ mergeParams: true });

router.post(
    "/",
    route({
        responses: { 200: { body: "CreateFingerprintResponse" } },
        spacebarOnly: false, // not part of public openapi
        authentication: "never",
    }),
    (req: Request, res: Response) => {
        const snowflake = Snowflake.generate();
        return res.json({
            fingerprint: `${snowflake}.${createHash("sha512").update(snowflake).digest("base64")}`,
        });
    },
);

export default router;
