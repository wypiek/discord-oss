import { route } from "@spacebar/api/middlewares";
import { DiscordApiErrors } from "@spacebar/util";
import { Router } from "express";

const router = Router({ mergeParams: true });

const noHandoffSession = () => {
    throw DiscordApiErrors.UNKNOWN_SESSION;
};

router.get("/", route({ authentication: "never", responses: { 404: { body: "APIErrorResponse" } } }), noHandoffSession);
router.post("/", route({ authentication: "never", responses: { 404: { body: "APIErrorResponse" } } }), noHandoffSession);

export default router;
