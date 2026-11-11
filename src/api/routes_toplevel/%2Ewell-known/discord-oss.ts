import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { buildInstanceDiscovery, capEndpoint, capSitekey } from "@spacebar/api/util";
import { appIconUrl, BRAND_COLOR, brandImageUrls, Config, helpUrl, instanceDescription, instanceName, packageVersion, requestOrigin } from "@spacebar/util";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        spacebarOnly: true,
        authentication: "never",
        description: "Describe this instance for clients that connect to it: its name and icon, its API, gateway, CDN and voice endpoints, and how to register",
        responses: { 200: { body: "DiscordOssWellKnownResponse" } },
    }),
    (req: Request, res: Response) => {
        const endpoint = capEndpoint();
        const images = brandImageUrls();
        res.set("Cache-Control", "public, max-age=300");
        res.json(
            buildInstanceDiscovery({
                config: Config.get(),
                origin: requestOrigin(req),
                name: instanceName(),
                description: instanceDescription(),
                iconPath: images.icon ?? appIconUrl(512),
                logoPath: images.logo,
                themeColor: BRAND_COLOR,
                version: packageVersion(),
                supportUrl: helpUrl(),
                captcha: endpoint ? { endpoint, sitekey: capSitekey() } : null,
            }),
        );
    },
);

export default router;
