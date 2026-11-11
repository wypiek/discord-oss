import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { UserViolation } from "@spacebar/database";
import { requestAppeal } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

// a user appealing one of their violations. The client sends PUT { signal, user_input }: signal is the reason they
// picked (0 didn't break the rules, 1 too strict, 2 disagree with the penalty, 3 something else)
const appeal = async (req: Request, res: Response) => {
    const violation = await UserViolation.findOne({
        where: { id: req.params.classification_id as string, user_id: req.user_id },
    });
    if (!violation) throw new HTTPError("Unknown violation", 404);
    if (violation.appeal_status != null) throw new HTTPError("This violation has already been appealed", 400);

    const signal = Number.isInteger(req.body?.signal) && req.body.signal >= 0 && req.body.signal <= 3 ? req.body.signal : null;
    const userInput = typeof req.body?.user_input === "string" ? req.body.user_input : null;
    await requestAppeal(violation, signal, userInput);
    res.sendStatus(204);
};

const options = route({
    responses: { 204: {}, 400: { body: "APIErrorResponse" }, 404: { body: "APIErrorResponse" } },
});
router.put("/", options, appeal);
router.post("/", options, appeal);

export default router;
