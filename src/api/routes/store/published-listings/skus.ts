import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { GUILD_POWERUPS_APPLICATION_ID, guildPowerupListings } from "@spacebar/api/util";

const router: Router = Router({ mergeParams: true });

router.get("/", route({}), (req: Request, res: Response) => {
    if (req.query.application_id === GUILD_POWERUPS_APPLICATION_ID) return res.json(guildPowerupListings());
    res.json([]);
});

router.get("/:sku_id", route({}), (req: Request, res: Response) => {
    //TODO
    // const id = req.params.id;
    res.json({
        id: "",
        summary: "",
        sku: {
            id: "",
            type: 1,
            dependent_sku_id: null,
            application_id: "",
            manifets_labels: [],
            access_type: 2,
            name: "",
            features: [],
            release_date: "",
            premium: false,
            slug: "",
            flags: 4,
            genres: [],
            legal_notice: "",
            application: {
                id: "",
                name: "",
                icon: "",
                description: "",
                summary: "",
                cover_image: "",
                primary_sku_id: "",
                hook: true,
                slug: "",
                guild_id: "",
                bot_public: "",
                bot_require_code_grant: false,
                verify_key: "",
                publishers: [
                    {
                        id: "",
                        name: "",
                    },
                ],
                developers: [
                    {
                        id: "",
                        name: "",
                    },
                ],
                system_requirements: {},
                show_age_gate: false,
                price: {
                    amount: 0,
                    currency: "EUR",
                },
                locales: [],
            },
            tagline: "",
            description: "",
            carousel_items: [
                {
                    asset_id: "",
                },
            ],
            header_logo_dark_theme: {}, //{id: "", size: 4665, mime_type: "image/gif", width 160, height: 160}
            header_logo_light_theme: {},
            box_art: {},
            thumbnail: {},
            header_background: {},
            hero_background: {},
            assets: [],
        },
    }).status(200);
});

export default router;
