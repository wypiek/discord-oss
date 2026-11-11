import { route } from "@spacebar/api/middlewares";
import { HubWaitlistSignupResponse, HubWaitlistSignupSchema } from "@spacebar/schemas";
import { Request, Response, Router } from "express";
const router = Router({ mergeParams: true });

router.post(
    "/signup",
    route({
        requestBody: "HubWaitlistSignupSchema",
        responses: {
            200: {
                body: "HubWaitlistSignupResponse",
            },
            400: {
                body: "APIErrorResponse",
            },
        },
    }),
    (req: Request, res: Response) => {
        const { email, school } = req.body as HubWaitlistSignupSchema;

        res.json({
            email,
            email_domain: email.split("@")[1],
            school,
            user_id: req.user_id,
        } as HubWaitlistSignupResponse);
    },
);

export default router;
