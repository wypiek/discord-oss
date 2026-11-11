import { Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { passwordlessStart } from "../conditional/start";

const router = Router({ mergeParams: true });

router.post("/", route({ authentication: "never", spacebarOnly: false }), passwordlessStart());

export default router;
