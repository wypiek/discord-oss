import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { IpDataClient } from "@spacebar/util";

const router: Router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    const country_code = (await IpDataClient.getIpInfo(req.ip!))?.country_code;
    res.json({ country_code: country_code }).status(200);
});

export default router;
