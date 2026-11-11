import { sendMessage } from "@spacebar/api";
import { HTTPError } from "lambert-server/HTTPError";
import { EmbedType, MessageReferenceType, MessageType, PollAnswerCount } from "@spacebar/schemas";
import { emitEvent, MessageUpdateEvent, pendingPolls } from "@spacebar/util";
import { Message } from "@spacebar/database";
import { MessageOptions } from "@spacebar/util/dtos/MessageOptions";
import { ProcessLifecycle } from "../../../util/util/ProcessLifecycle";

let stopping = false;
const finalizations = new Map<string, Promise<Message | null>>();
let recovering: Promise<void> | undefined;
const RECOVERY_BATCH_SIZE = 100;
const pollHeap: string[] = [];
let pollTimer: ReturnType<typeof setTimeout> | undefined;
let timerExpiry: number | undefined;
let expiring: Promise<void> | undefined;
const shutdownRequested = () => stopping || ProcessLifecycle.shutdownRequested;

ProcessLifecycle.eventEmitter.on("stopping", async () => {
    stopping = true;
    clearPollTimer();
    pollHeap.length = 0;
    pendingPolls.clear();
    await Promise.allSettled([recovering, expiring, ...finalizations.values()]);
});

type StoredAnswerCount = Omit<PollAnswerCount, "me_voted" | "id"> & {
    id: number | string;
    voters: string[];
};

export function generatePollResultsMessage(message: Message): MessageOptions {
    if (!message.poll) return {};

    const counts = (message.poll.results?.answer_counts ?? []) as unknown as StoredAnswerCount[];
    const totalVotes = counts.reduce((sum, answer) => sum + answer.count, 0);
    const best = Math.max(0, ...counts.map((answer) => answer.count));
    const winners = best > 0 ? counts.filter((answer) => answer.count === best) : [];

    const fields = [
        { name: "poll_question_text", value: message.poll.question.text ?? "" },
        { name: "victor_answer_votes", value: `${best}` },
        { name: "total_votes", value: `${totalVotes}` },
    ];

    if (winners.length === 1) {
        const winner = message.poll.answers.find((answer) => Number(answer.answer_id) === Number(winners[0].id));
        fields.push({ name: "victor_answer_id", value: `${winners[0].id}` });
        if (winner?.poll_media.text) fields.push({ name: "victor_answer_text", value: winner.poll_media.text });
        const emoji = winner?.poll_media.emoji;
        if (emoji) {
            if (emoji.id) fields.push({ name: "victor_answer_emoji_id", value: `${emoji.id}` });
            if (emoji.name) fields.push({ name: "victor_answer_emoji_name", value: emoji.name });
            fields.push({ name: "victor_answer_emoji_animated", value: `${!!emoji.animated}` });
        }
    }

    return {
        type: MessageType.POLL_RESULT,
        channel_id: message.channel_id,
        author_id: message.author_id,
        message_reference: {
            type: MessageReferenceType.DEFAULT,
            message_id: message.id,
            channel_id: message.channel_id,
            guild_id: message.guild_id,
        },
        embeds: [{ type: EmbedType.poll_result, fields }],
    };
}

export function finalizePoll(messageId: string): Promise<Message | null> {
    if (shutdownRequested()) return Promise.reject(new HTTPError("Server is shutting down", 503));
    const running = finalizations.get(messageId);
    if (running) return running;
    const work = finalizePollOnce(messageId).finally(() => finalizations.delete(messageId));
    finalizations.set(messageId, work);
    return work;
}

async function finalizePollOnce(messageId: string) {
    removePendingPoll(messageId);
    const finalized = await Message.mutate({ id: messageId }, (message) => {
        if (!message?.poll || message.poll.results?.is_finalized) return false;
        message.poll.results = { answer_counts: [], ...message.poll.results, is_finalized: true };
        if (new Date(message.poll.expiry) > new Date()) message.poll.expiry = new Date();
        return true;
    });
    const message = await Message.findOne({ where: { id: messageId }, relations: { author: true } });
    if (!finalized || !message) return message;

    await emitEvent({
        event: "MESSAGE_UPDATE",
        channel_id: message.channel_id,
        data: message.toJSON(),
    } satisfies MessageUpdateEvent);

    await sendMessage(generatePollResultsMessage(message));
    return message;
}

export function scheduleSavedPoll(message: Pick<Message, "id" | "poll">) {
    if (!message.poll?.expiry || message.poll.results?.is_finalized) return;
    const expiry = new Date(message.poll.expiry).getTime();
    if (Number.isFinite(expiry)) schedulePendingPoll(message.id, expiry);
}

export async function addPendingPoll(message: Pick<Message, "id">, timeoutTime: number) {
    schedulePendingPoll(message.id, Date.now() + Math.max(timeoutTime, 0));
}

function pollExpiresBefore(left: number, right: number) {
    const leftId = pollHeap[left];
    const rightId = pollHeap[right];
    const leftExpiry = pendingPolls.get(leftId)!.expiry;
    const rightExpiry = pendingPolls.get(rightId)!.expiry;
    return leftExpiry < rightExpiry || (leftExpiry === rightExpiry && leftId < rightId);
}

function swapPendingPolls(left: number, right: number) {
    [pollHeap[left], pollHeap[right]] = [pollHeap[right], pollHeap[left]];
    pendingPolls.get(pollHeap[left])!.position = left;
    pendingPolls.get(pollHeap[right])!.position = right;
}

function repairPollHeap(position: number) {
    let current = position;
    while (current > 0) {
        const parent = Math.floor((current - 1) / 2);
        if (!pollExpiresBefore(current, parent)) break;
        swapPendingPolls(current, parent);
        current = parent;
    }
    while (current * 2 + 1 < pollHeap.length) {
        const left = current * 2 + 1;
        const right = left + 1;
        const child = right < pollHeap.length && pollExpiresBefore(right, left) ? right : left;
        if (!pollExpiresBefore(child, current)) break;
        swapPendingPolls(current, child);
        current = child;
    }
}

function clearPollTimer() {
    clearTimeout(pollTimer);
    pollTimer = undefined;
    timerExpiry = undefined;
}

function armPollTimer() {
    if (shutdownRequested() || expiring) return;
    const first = pendingPolls.get(pollHeap[0]);
    if (!first) return clearPollTimer();
    if (pollTimer && timerExpiry === first.expiry) return;
    clearPollTimer();
    const timeout = setTimeout(
        () => {
            if (pollTimer !== timeout) return;
            clearPollTimer();
            if (shutdownRequested()) return;
            const work = Promise.resolve()
                .then(async () => {
                    while (!shutdownRequested() && pollHeap.length) {
                        const messageId = pollHeap[0];
                        if (pendingPolls.get(messageId)!.expiry > Date.now()) break;
                        await finalizePoll(messageId).catch((error) => console.error("[Polls] failed to finalize poll", error));
                    }
                })
                .finally(() => {
                    expiring = undefined;
                    armPollTimer();
                });
            expiring = work;
            return work;
        },
        Math.min(Math.max(first.expiry - Date.now(), 0), 2 ** 31 - 1),
    ).unref();
    pollTimer = timeout;
    timerExpiry = first.expiry;
}

function removePendingPoll(messageId: string) {
    const pending = pendingPolls.get(messageId);
    if (!pending) return;
    const last = pollHeap.pop()!;
    pendingPolls.delete(messageId);
    if (pending.position < pollHeap.length) {
        pollHeap[pending.position] = last;
        pendingPolls.get(last)!.position = pending.position;
        repairPollHeap(pending.position);
    }
    armPollTimer();
}

function schedulePendingPoll(messageId: string, expiry: number) {
    if (shutdownRequested()) return;
    const existing = pendingPolls.get(messageId);
    if (existing) {
        existing.expiry = expiry;
        repairPollHeap(existing.position);
    } else {
        pendingPolls.set(messageId, { expiry, position: pollHeap.length });
        pollHeap.push(messageId);
        repairPollHeap(pollHeap.length - 1);
    }
    armPollTimer();
}

export function recoverPendingPolls(): Promise<void> {
    if (shutdownRequested()) return Promise.resolve();
    if (recovering) return recovering;
    const work = (async () => {
        let after: string | undefined;
        let recovered = 0;
        let expired = 0;
        while (!shutdownRequested()) {
            const query = Message.createQueryBuilder("message")
                .select("message.id", "id")
                .addSelect("message.poll->>'expiry'", "expiry")
                .where("message.poll IS NOT NULL")
                .andWhere("COALESCE(message.poll->'results'->>'is_finalized', 'false') <> 'true'")
                .orderBy("message.id", "ASC")
                .take(RECOVERY_BATCH_SIZE);
            if (after) query.andWhere("message.id > :after", { after });
            const messages = await query.getRawMany<{ id: string; expiry: string | null }>();
            if (!messages.length) break;
            for (const message of messages) {
                if (shutdownRequested()) break;
                after = message.id;
                const remaining = new Date(message.expiry ?? "").getTime() - Date.now();
                if (!(remaining > 0)) {
                    await finalizePoll(message.id).catch((error) => console.error("[Polls] startup finalization failed", error));
                    expired++;
                } else await addPendingPoll(message, remaining);
                recovered++;
                if (recovered % 1000 === 0) console.log(`[Polls] recovered ${recovered} polls, ${expired} expired`);
            }
            if (messages.length < RECOVERY_BATCH_SIZE) break;
        }
        console.log(`[Polls] recovery ${shutdownRequested() ? "stopped" : "finished"}: ${recovered} polls, ${expired} expired`);
    })().finally(() => {
        recovering = undefined;
    });
    recovering = work;
    return work;
}

export async function finalizeExpiredPolls(until = Infinity) {
    let after: string | undefined;
    let finalized = 0;
    while (!shutdownRequested() && Date.now() < until) {
        const query = Message.createQueryBuilder("message")
            .select("message.id", "id")
            .addSelect("message.poll->>'expiry'", "expiry")
            .where("message.poll IS NOT NULL")
            .andWhere("COALESCE(message.poll->'results'->>'is_finalized', 'false') <> 'true'")
            .orderBy("message.id", "ASC")
            .take(RECOVERY_BATCH_SIZE);
        if (after) query.andWhere("message.id > :after", { after });
        const messages = await query.getRawMany<{ id: string; expiry: string | null }>();
        for (const message of messages) {
            if (shutdownRequested() || Date.now() >= until) break;
            after = message.id;
            if (new Date(message.expiry ?? "").getTime() > Date.now()) continue;
            await finalizePoll(message.id).then(
                () => finalized++,
                (error) => console.error("[Polls] failed to finalize poll", error),
            );
        }
        if (messages.length < RECOVERY_BATCH_SIZE) break;
    }
    return finalized;
}
