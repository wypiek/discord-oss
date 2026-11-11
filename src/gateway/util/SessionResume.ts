import { Payload } from "./Constants";
import { WebSocket } from "./WebSocket";
import { ProcessLifecycle } from "../../util/util/ProcessLifecycle";
import { Config } from "../../util/util/Config";

export const RESUME_WINDOW_MS = 90_000;
export const REPLAY_BUFFER_SIZE = 250;
export const MAX_RESUME_BUFFER = 5000;
export const MAX_RESUME_BYTES = 16 * 1024 * 1024;
export const MAX_REPLAY_BYTES = 8 * 1024 * 1024;
const queueSizes = new WeakMap<Payload[], number>();
const payloadSizes = new WeakMap<Payload, number>();

export function notePayloadSize(payload: Payload, bytes: number) {
    payloadSizes.set(payload, bytes);
}

function payloadSize(payload: Payload) {
    let size = payloadSizes.get(payload);
    if (size === undefined) {
        size = new TextEncoder().encode(JSON.stringify(payload, (_, value) => (typeof value === "bigint" ? value.toString() : value))).byteLength;
        payloadSizes.set(payload, size);
    }
    return size;
}

type Retained = { owner: string; bytes: number };
const retainedQueues = new WeakMap<Payload[], Retained>();
const retainedByOwner = new Map<string, number>();
const droppedSequences = new WeakMap<Payload[], number>();
let retainedTotal = 0;

const adjustRetained = (record: Retained, delta: number) => {
    record.bytes += delta;
    retainedTotal += delta;
    const next = (retainedByOwner.get(record.owner) ?? 0) + delta;
    if (next > 0) retainedByOwner.set(record.owner, next);
    else retainedByOwner.delete(record.owner);
};
const retainedCollector = new FinalizationRegistry<Retained>((record) => adjustRetained(record, -record.bytes));

export const retainedDispatchBytes = (owner?: string) => (owner === undefined ? retainedTotal : (retainedByOwner.get(owner) ?? 0));

export function releaseDispatchQueue(queue?: Payload[]) {
    const record = queue && retainedQueues.get(queue);
    if (!record) return;
    adjustRetained(record, -record.bytes);
    retainedQueues.delete(queue);
    retainedCollector.unregister(record);
}

export const droppedThrough = (queue?: Payload[]) => (queue && droppedSequences.get(queue)) ?? -1;

const markDropped = (queue: Payload[], payload: Payload) => {
    if (payload.s !== undefined && payload.s !== null) droppedSequences.set(queue, Math.max(droppedThrough(queue), payload.s));
};

export function boundedDispatchPush(queue: Payload[], payload: Payload, count: number, bytes: number, evict = false, owner?: string) {
    const size = payloadSize(payload);
    let total = queueSizes.get(queue) ?? queue.reduce((sum, item) => sum + payloadSize(item), 0);
    let record = owner === undefined ? undefined : retainedQueues.get(queue);
    if (owner !== undefined && !record) {
        record = { owner, bytes: 0 };
        retainedQueues.set(queue, record);
        retainedCollector.register(queue, record, record);
        adjustRetained(record, total);
    }
    const { retainedDispatchBytes: instanceBudget, retainedDispatchBytesPerUser: userBudget } = Config.get().limits.gateway;
    const overBudget = () =>
        queue.length >= count || total + size > bytes || (!!record && (retainedTotal + size > instanceBudget || (retainedByOwner.get(record.owner) ?? 0) + size > userBudget));
    if (size > bytes) {
        if (evict) markDropped(queue, payload);
        return false;
    }
    if (evict)
        while (queue.length && overBudget()) {
            const dropped = queue.shift()!;
            const droppedSize = payloadSize(dropped);
            total -= droppedSize;
            if (record) adjustRetained(record, -droppedSize);
            markDropped(queue, dropped);
        }
    if (overBudget()) {
        if (evict) markDropped(queue, payload);
        queueSizes.set(queue, total);
        return false;
    }
    queue.push(payload);
    queueSizes.set(queue, total + size);
    if (record) adjustRetained(record, size);
    return true;
}

export const resumableSockets = new Map<string, WebSocket>();
const heldReleases = new WeakMap<WebSocket, () => Promise<void>>();
const activeReleases = new Set<Promise<void>>();
let stopping = false;

const cancelResumeWindow = (socket: WebSocket) => {
    clearTimeout(socket.resumeTimer);
    socket.resumeTimer = undefined;
    if (resumableSockets.get(socket.session_id) === socket) resumableSockets.delete(socket.session_id);
    releaseDispatchBuffers(socket);
};

export function releaseDispatchBuffers(socket: WebSocket) {
    releaseDispatchQueue(socket.resumeBuffer);
    releaseDispatchQueue(socket.replayBuffer);
    socket.resumeBuffer = undefined;
    socket.replayBuffer = undefined;
}

ProcessLifecycle.eventEmitter.on("stopping", async () => {
    stopping = true;
    for (const socket of resumableSockets.values()) {
        cancelResumeWindow(socket);
        if (!socket.resumedBy) heldReleases.get(socket)?.();
    }
    await Promise.allSettled(activeReleases);
});

export function resolveSocket(socket: WebSocket) {
    let current = socket;
    while (current.resumedBy) current = current.resumedBy;
    return current;
}

export function rememberDispatch(socket: WebSocket, payload: Payload) {
    if (payload.op !== 0 || payload.s === undefined || payload.t === "READY") return;
    socket.replayBuffer ??= [];
    boundedDispatchPush(socket.replayBuffer, payload, REPLAY_BUFFER_SIZE, MAX_REPLAY_BYTES, true, socket.user_id ?? "");
}

export const isFinalClose = (code?: number) => code === 1000 || code === 1001;

export function holdForResume(socket: WebSocket, cleanup: () => Promise<void>, code?: number) {
    let release = heldReleases.get(socket);
    if (!release) {
        let pending: Promise<void> | undefined;
        release = () => {
            if (pending) return pending;
            const work = Promise.resolve()
                .then(cleanup)
                .catch((error) => console.error(`[Gateway/${socket.user_id}] listener cleanup failed`, error))
                .finally(() => activeReleases.delete(work));
            pending = work;
            activeReleases.add(work);
            return work;
        };
        heldReleases.set(socket, release);
    }
    clearTimeout(socket.resumeTimer);
    if (stopping || isFinalClose(code) || !socket.user_id || !socket.session_id || socket.session_id.startsWith("TEMP_")) {
        cancelResumeWindow(socket);
        return release();
    }

    releaseDispatchQueue(socket.resumeBuffer);
    socket.resumeBuffer = [];
    resumableSockets.set(socket.session_id, socket);
    socket.resumeTimer = setTimeout(() => {
        cancelResumeWindow(socket);
        if (!socket.resumedBy) return release();
    }, RESUME_WINDOW_MS).unref();
}

export function bufferForResume(socket: WebSocket, payload: Payload) {
    if (!socket.resumeBuffer) return false;
    if (!boundedDispatchPush(socket.resumeBuffer, payload, MAX_RESUME_BUFFER, MAX_RESUME_BYTES, false, socket.user_id ?? "")) {
        cancelResumeWindow(socket);
        heldReleases.get(socket)?.();
        return true;
    }
    return true;
}
