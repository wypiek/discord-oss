import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { Config } from "@spacebar/util";

const router = Router({ mergeParams: true });

router.post("/", route({ authentication: "optional", spacebarOnly: false }), (req: Request, res: Response) => {
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const min = Config.get().register.password.minLength ?? 8;
    const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((x) => x.test(password)).length;
    const unique = new Set(password).size;
    const score = password.length < min ? 0 : Math.min(4, Math.floor(classes / 2) + (password.length >= 12 ? 1 : 0) + (password.length >= 16 ? 1 : 0) + (unique >= 8 ? 1 : 0));
    res.json({ valid: password.length >= min && password.length <= 72, password_strength: score });
});

export default router;
