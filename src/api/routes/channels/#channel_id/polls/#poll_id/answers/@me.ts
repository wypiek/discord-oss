import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { PollAnswerCount, PollUserAnswersSchema } from "@spacebar/schemas";
import { Message } from "@spacebar/database";
import { DiscordApiErrors, emitEvent, ErrorList, FieldError, makeObjectErrorContent, MessagePollVoteAddEvent, MessagePollVoteRemoveEvent } from "@spacebar/util";

const router: Router = Router({ mergeParams: true });

type StoredAnswerCount = Omit<PollAnswerCount, "me_voted" | "id"> & {
    id: number;
    voters: string[];
};

router.put("/", route({ requestBody: "PollUserAnswersSchema", permission: "VIEW_CHANNEL" }), async (req: Request, res: Response) => {
    const payload = req.body as PollUserAnswersSchema;
    const { poll_id, channel_id } = req.params as { [key: string]: string };

    const answerIds = [...new Set(payload.answer_ids.map(Number))];
    const events = await Message.mutate({ id: poll_id, channel_id }, (message) => {
        const events: (MessagePollVoteAddEvent | MessagePollVoteRemoveEvent)[] = [];
        if (!message?.poll) throw DiscordApiErrors.UNKNOWN_MESSAGE;
        if (message.poll.results?.is_finalized || new Date() > new Date(message.poll.expiry)) throw DiscordApiErrors.POLL_EXPIRED;

        if (answerIds.some((id) => !message.poll!.answers.some((answer) => Number(answer.answer_id) === id))) {
            const errors: ErrorList = {};
            errors["answer_ids"] = makeObjectErrorContent("BASE_TYPE_CHOICES", "Invalid poll answer.");
            throw new FieldError(50035, "Invalid form body", errors);
        }
        if (!message.poll.allow_multiselect && answerIds.length > 1) {
            const errors: ErrorList = {};
            errors["answer_ids"] = makeObjectErrorContent("CANNOT_ADD_MULTIPLE_POLL_ANSWERS", "Multiple votes are not allowed for this poll.");
            throw new FieldError(50035, "Invalid form body", errors);
        }

        message.poll.results ??= { is_finalized: false, answer_counts: [] };
        const counts = message.poll.results.answer_counts as unknown as StoredAnswerCount[];
        const data = (answer_id: number) => ({
            answer_id,
            channel_id,
            message_id: poll_id,
            user_id: req.user_id,
            guild_id: message.guild_id,
        });

        for (const id of answerIds) {
            let count = counts.find((answer) => Number(answer.id) === id);
            if (!count) {
                count = { id, count: 0, voters: [] };
                counts.push(count);
            }
            if (count.voters.includes(req.user_id)) continue;
            count.voters.push(req.user_id);
            count.count = count.voters.length;
            events.push({ event: "MESSAGE_POLL_VOTE_ADD", channel_id, data: data(id) });
        }

        for (const count of counts.filter((answer) => !answerIds.includes(Number(answer.id)) && answer.voters.includes(req.user_id))) {
            count.voters = count.voters.filter((voter) => voter !== req.user_id);
            count.count = count.voters.length;
            events.push({
                event: "MESSAGE_POLL_VOTE_REMOVE",
                channel_id,
                data: data(Number(count.id)),
            });
        }

        message.poll.results.answer_counts = counts.filter((answer) => answer.count > 0) as unknown as PollAnswerCount[];
        return events;
    });
    for (const event of events) await emitEvent(event);
    res.sendStatus(204);
});

export default router;
