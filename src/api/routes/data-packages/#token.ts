import { Request, Response, Router } from "express";
import { storage } from "@spacebar/cdn/util/Storage";
import { route } from "@spacebar/api/middlewares";
import { harvestPath, readTicket } from "@spacebar/api/util";
import { HTTPError } from "lambert-server/HTTPError";

const router = Router({ mergeParams: true });

router.get("/", route({ authentication: "never", responses: { 200: {}, 404: { body: "APIErrorResponse" } } }), async (req: Request, res: Response) => {
    const decoded = readTicket<{ typ: string; uid?: string; hid?: string }>(req.params.token, "harvest");
    if (!decoded?.uid || !decoded.hid) throw new HTTPError("Unknown data package", 404);
    const file = await storage.get(harvestPath(decoded.uid, decoded.hid));
    if (!file) throw new HTTPError("Unknown data package", 404);
    res.set("Content-Type", "application/zip");
    res.set("Content-Disposition", `attachment; filename="package-${decoded.hid}.zip"`);
    res.send(file);
});

export default router;
