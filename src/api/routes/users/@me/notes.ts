import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { Note, User } from "@spacebar/database";
import { Snowflake, emitEvent } from "@spacebar/util";

const router: Router = Router({ mergeParams: true });

router.get(
    "/:user_id",
    route({
        responses: {
            200: {
                body: "UserNoteResponse",
            },
            404: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { user_id } = req.params as { [key: string]: string };

        const note = await Note.findOne({
            where: {
                owner: { id: req.user_id },
                target: { id: user_id },
            },
        });

        return res.json({
            note: note?.content ?? "",
            note_user_id: user_id,
            user_id: req.user_id,
        });
    },
);

router.put(
    "/:user_id",
    route({
        requestBody: "UserNoteUpdateSchema",
        responses: {
            204: {},
            404: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { user_id } = req.params as { [key: string]: string };
        const owner = req.user;
        const target = await User.findOneOrFail({ where: { id: user_id } }); //if noted user does not exist throw
        const { note } = req.body;

        if (note && note.length) {
            // upsert a note
            if (
                await Note.findOne({
                    where: {
                        owner: { id: owner.id },
                        target: { id: target.id },
                    },
                })
            ) {
                await Note.update({ owner: { id: owner.id }, target: { id: target.id } }, { owner, target, content: note });
            } else {
                await Note.insert({
                    id: Snowflake.generate(),
                    owner,
                    target,
                    content: note,
                });
            }
        } else {
            await Note.delete({
                owner: { id: owner.id },
                target: { id: target.id },
            });
        }

        await emitEvent({
            event: "USER_NOTE_UPDATE",
            data: {
                note: note,
                id: target.id,
            },
            user_id: owner.id,
        });

        return res.sendStatus(204);
    },
);

export default router;
