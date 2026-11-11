import { route } from "@spacebar/api/middlewares";
import { FieldErrors } from "@spacebar/util";
import emailProviders from "email-providers/all.json";
import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { EmailDomainLookupResponse, EmailDomainLookupSchema, EmailDomainLookupVerifyCodeSchema } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

router.post(
    "/",
    route({
        requestBody: "EmailDomainLookupSchema",
        responses: {
            200: {
                body: "EmailDomainLookupResponse",
            },
            400: {
                body: "APIErrorResponse",
            },
        },
    }),
    (req: Request, res: Response) => {
        const { email } = req.body as EmailDomainLookupSchema;

        const [_, tld] = email.split("@");

        if (emailProviders.includes(tld.toLowerCase())) {
            throw FieldErrors({
                name: {
                    message: "That looks like a personal email address. Please use your official student email.",
                    code: "EMAIL_IS_UNOFFICIAL",
                },
            });
        }

        return res.json({
            guilds_info: [],
            has_matching_guild: false,
        } as EmailDomainLookupResponse);
    },
);

// noinspection JSUnusedLocalSymbols - TODO: implement
router.post(
    "/verify-code",
    route({
        requestBody: "EmailDomainLookupVerifyCodeSchema",
        responses: {
            // 200: {
            // 	body: "EmailDomainLookupVerifyCodeResponse",
            // },
            400: {
                body: "APIErrorResponse",
            },
            501: {},
        },
    }),
    (req: Request, res: Response) => {
        const { email } = req.body as EmailDomainLookupVerifyCodeSchema;

        const [_, tld] = email.split("@");

        if (emailProviders.includes(tld.toLowerCase())) {
            throw FieldErrors({
                name: {
                    message: "That looks like a personal email address. Please use your official student email.",
                    code: "EMAIL_IS_UNOFFICIAL",
                },
            });
        }

        throw new HTTPError("Not implemented", 501);

        // return res.json({
        // 	guild: null,
        // 	joined: false,
        // } as EmailDomainLookupVerifyCodeResponse);
    },
);

export default router;
