import { In } from "typeorm";
import { Stream } from "@spacebar/database";
import { ActivityCredit, creditActivity } from "@spacebar/util/util/ActivityBadges";
import { VoiceSessions } from "./VoiceSessions";

export const STREAM_SAMPLE_MS = 60_000;

type SampledStreamSocket = { type: string; server_id?: string; user_id?: string; readyState: number };

export function streamCredits(sockets: Iterable<SampledStreamSocket>, owners: Map<string, string>, seconds: number): ActivityCredit[] {
    const watchers = new Map<string, Set<string>>();
    for (const socket of sockets) {
        if (socket.type !== "stream" || socket.readyState !== 1 || !socket.server_id || !socket.user_id) continue;
        const users = watchers.get(socket.server_id) ?? new Set<string>();
        users.add(socket.user_id);
        watchers.set(socket.server_id, users);
    }
    const credits: ActivityCredit[] = [];
    for (const [streamId, users] of watchers) {
        const owner = owners.get(streamId);
        if (owner && users.has(owner) && users.size > 1) credits.push({ user_id: owner, stream_seconds: seconds });
    }
    return credits;
}

async function sample() {
    const sockets = VoiceSessions.all();
    const streamIds = [...new Set(sockets.filter((socket) => socket.type === "stream" && socket.server_id).map((socket) => socket.server_id))];
    if (!streamIds.length) return;
    const owners = new Map((await Stream.find({ where: { id: In(streamIds) }, select: { id: true, owner_id: true } })).map((stream) => [stream.id, stream.owner_id]));
    await creditActivity(streamCredits(sockets, owners, STREAM_SAMPLE_MS / 1000));
}

let timer: ReturnType<typeof setInterval> | undefined;

export function startStreamTimeSampler() {
    timer ??= setInterval(() => {
        sample().catch((error) => console.warn("[Badges] Could not record stream time:", (error as Error).message));
    }, STREAM_SAMPLE_MS).unref();
}

export function stopStreamTimeSampler() {
    clearInterval(timer);
    timer = undefined;
}
