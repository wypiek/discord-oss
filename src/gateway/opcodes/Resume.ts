import { Session } from "@spacebar/database";
import { droppedThrough, holdForResume, OPCODES, Payload, releaseDispatchBuffers, resumableSockets, Send, WebSocket } from "@spacebar/gateway";
import { broadcastPresence, checkToken } from "@spacebar/util";
import { CLOSECODES } from "../util/Constants";
import { settlePendingConnection } from "../util/PendingConnections";
import { resubscribeMemberLists } from "./LazyRequest";

export async function onResume(this: WebSocket, { d }: Payload) {
    if (this.user_id) return this.close(CLOSECODES.Already_authenticated);
    const { token, session_id, seq } = (d ?? {}) as {
        token?: string;
        session_id?: string;
        seq?: number;
    };
    const previous = session_id ? resumableSockets.get(session_id) : undefined;
    const invalidate = () => Send(this, { op: OPCODES.Invalid_Session, d: false });

    if (!token || !previous || previous.resumedBy || !previous.resumeBuffer) return invalidate();
    const tokenData = await checkToken(token).catch(() => undefined);
    if (this.readyState !== this.OPEN) return;
    if (tokenData?.user?.id !== previous.user_id) return invalidate();
    const authSessionId = previous.session?.session_id;
    const originalCredential = (value: string | undefined) => value?.replace(/^(?:Bot|Bearer) /, "");
    const sameAuthSession = tokenData.session ? tokenData.session.session_id === authSessionId : originalCredential(token) === originalCredential(previous.accessToken);
    if (!authSessionId || !sameAuthSession) return invalidate();
    const authSession = await Session.findOne({
        where: { session_id: authSessionId, user_id: previous.user_id },
        select: { session_id: true, status: true },
    });
    if (this.readyState !== this.OPEN) return;
    if (!authSession || previous.resumedBy || resumableSockets.get(session_id!) !== previous) return invalidate();
    if ((seq ?? -1) < droppedThrough(previous.replayBuffer)) return invalidate();

    resumableSockets.delete(session_id!);
    clearTimeout(this.readyTimeout);
    settlePendingConnection(this);
    clearTimeout(previous.resumeTimer);

    this.user_id = previous.user_id;
    this.session_id = previous.session_id;
    this.session = previous.session;
    this.accessToken = token;
    this.capabilities = previous.capabilities;
    this.intents = previous.intents;
    this.isBot = previous.isBot;
    this.large_threshold = previous.large_threshold;
    this.shard_id = previous.shard_id;
    this.shard_count = previous.shard_count;
    this.events = previous.events;
    this.member_events = previous.member_events;
    this.permissions = previous.permissions;
    this.member_lists = previous.member_lists;
    resubscribeMemberLists(this);
    this.listen_options = previous.listen_options;
    this.listenerCleanup = previous.listenerCleanup;
    this.recentTransactions = previous.recentTransactions;
    this.sequence = previous.sequence;

    const seen = new Set<number>();
    const missed = [...(previous.replayBuffer ?? []), ...previous.resumeBuffer].filter((x) => {
        if ((x.s ?? -1) <= (seq ?? -1) || seen.has(x.s!)) return false;
        seen.add(x.s!);
        return true;
    });
    releaseDispatchBuffers(previous);
    previous.resumedBy = this;

    this.once("close", (code: number) => holdForResume(this, this.listenerCleanup!, code));

    for (const payload of missed) await Send(this, payload);
    await Send(this, { op: OPCODES.Dispatch, t: "RESUMED", s: this.sequence++, d: {} });

    if (this.session) {
        this.session.last_seen = new Date();
        await Session.update(
            { session_id: this.session.session_id },
            {
                last_seen: this.session.last_seen,
                status: this.session.status,
                activities: this.session.activities,
                client_status: this.session.client_status,
            },
        );
        if (authSession.status === "offline" && this.session.status !== "offline") await broadcastPresence(this.user_id);
    }
    console.log(`[Gateway/${this.user_id}] RESUMED ${this.session_id} replaying ${missed.length} events from seq ${seq}`);
}
