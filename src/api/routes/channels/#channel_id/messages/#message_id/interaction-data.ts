import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { ApplicationCommand, Message } from "@spacebar/database";
import { DiscordApiErrors } from "@spacebar/util";
import { serializeCommand } from "@spacebar/api/util/handlers/ApplicationCommands";

const router = Router({ mergeParams: true });

router.get("/", route({ permission: "VIEW_CHANNEL" }), async (req: Request, res: Response) => {
    const message = await Message.findOne({
        where: { id: req.params.message_id as string, channel_id: req.params.channel_id as string },
    });
    if (!message?.interaction) throw DiscordApiErrors.UNKNOWN_MESSAGE;
    const { id, type, name, command_id, options } = message.interaction;
    const command = command_id ? await ApplicationCommand.findOne({ where: { id: command_id } }) : null;
    res.json({
        id,
        type,
        name,
        application_command: command
            ? serializeCommand(command)
            : {
                  id: command_id,
                  application_id: message.application_id,
                  name: name.split(" ")[0],
                  type: 1,
                  version: "0",
              },
        options: options ?? [],
    });
});

export default router;
