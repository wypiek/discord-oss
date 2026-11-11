import { Router, Response, Request } from "express";
import { route } from "@spacebar/api/middlewares";
import { instanceIconDataUri, instanceLogo, sendBrandImage, wordmarkSvg } from "@spacebar/util";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        spacebarOnly: true,
        authentication: "never",
    }),
    async (req: Request, res: Response) => {
        const logo = instanceLogo();
        if (logo) return sendBrandImage(res, logo);
        res.set("Cache-Control", "public, max-age=21600")
            .type("image/svg+xml")
            .send(wordmarkSvg(undefined, await instanceIconDataUri()));
    },
);

export default router;
