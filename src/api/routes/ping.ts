import { route } from "@spacebar/api/middlewares";
import { Config } from "@spacebar/util";
import { Request, Response, Router } from "express";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        responses: {
            200: {
                body: "InstancePingResponse",
            },
        },
        spacebarOnly: true,
        authentication: "never",
    }),
    (req: Request, res: Response) => {
        const { general } = Config.get();
        res.send({
            ping: "pong!",
            instance: {
                id: general.instanceId,
                name: general.instanceName,
                description: general.instanceDescription,
                image: general.image,

                correspondenceEmail: general.correspondenceEmail,
                correspondenceUserID: general.correspondenceUserID,

                frontPage: general.frontPage,
                tosPage: general.tosPage,
            },
        });
    },
);

export default router;
