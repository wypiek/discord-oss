import { route } from "@spacebar/api/middlewares";
import { IpDataClient } from "@spacebar/util";
import { Request, Response, Router } from "express";
const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        responses: {
            200: {
                body: "LocationMetadataResponse",
            },
        },
        authentication: "never",
    }),
    async (req: Request, res: Response) => {
        //TODO
        //Note: It's most likely related to legal. At the moment Discord hasn't finished this too
        const country_code = (await IpDataClient.getIpInfo(req.ip!))?.country_code;
        res.json({
            consent_required: false,
            country_code: country_code ?? "US",
            promotional_email_opt_in: { required: false, pre_checked: false },
        });
    },
);

export default router;
