import { VoicePayload, WebRtcWebSocket } from "../util";
import { DaveSession } from "../dave/DaveSession";

const session = (socket: WebRtcWebSocket) => (socket.daveVersion > 0 ? DaveSession.find(socket.webRtcClient?.voiceRoomId) : undefined);

export async function onDaveReadyForTransition(this: WebRtcWebSocket, data: VoicePayload) {
    await session(this)?.onReadyForTransition(this.user_id, Number(data.d?.transition_id));
}

export async function onDaveInvalidCommitWelcome(this: WebRtcWebSocket, data: VoicePayload) {
    await session(this)?.onInvalidCommitWelcome(this.user_id, Number(data.d?.transition_id));
}

export async function onMlsKeyPackage(this: WebRtcWebSocket, data: VoicePayload) {
    if (!Buffer.isBuffer(data.d)) return;
    await session(this)?.onKeyPackage(this, data.d);
}

export async function onMlsCommitWelcome(this: WebRtcWebSocket, data: VoicePayload) {
    if (!Buffer.isBuffer(data.d)) return;
    await session(this)?.onCommitWelcome(this, data.d);
}
