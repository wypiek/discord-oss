import { randomUUID } from "node:crypto";
import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { listDirectoryApplications } from "@spacebar/api/util/handlers/Application";
import { assertMaxLength } from "@spacebar/api/util/utility/inputCaps";

const router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    assertMaxLength("query", req.query.query, 100);
    const pageSize = Math.min(Math.max(Number(req.query.page_size) || 20, 1), 50);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const { applications, total } = await listDirectoryApplications(String(req.query.query ?? ""), (page - 1) * pageSize, pageSize);
    res.json({
        results: applications.map((data) => ({ type: 1, data })),
        counts_by_category: {},
        result_count: total,
        num_pages: Math.ceil(total / pageSize),
        type: 1,
        load_id: randomUUID(),
    });
});

export default router;
