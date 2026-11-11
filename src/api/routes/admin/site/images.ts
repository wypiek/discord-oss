import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { SITE_IMAGE_DATA_URI, SITE_IMAGE_FILE, siteImageUrl } from "@spacebar/api/util";
import { handleFile } from "@spacebar/util";
import { AdminSiteImageUploadSchema } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

router.post(
    "/",
    route({
        right: "OPERATOR",
        spacebarOnly: true,
        requestBody: "AdminSiteImageUploadSchema",
        description: "Upload an image for blog posts and help articles",
    }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminSiteImageUploadSchema;
        if (!SITE_IMAGE_DATA_URI.test(body.image)) throw new HTTPError("image must be a PNG, JPEG, WebP, AVIF or GIF data: URI", 400);
        const id = await handleFile("/site-images", body.image);
        if (!id || !SITE_IMAGE_FILE.test(id)) throw new HTTPError("The CDN refused the image", 400);
        res.status(201).json({ id, url: siteImageUrl(id) });
    },
);

export default router;
