import { CLOSECODES, setHeartbeat } from "@spacebar/gateway";
import { VoiceOPCodes, VoicePayload, WebRtcWebSocket, Send } from "../util";

export async function onHeartbeat(this: WebRtcWebSocket, data: VoicePayload) {
    const nonce = typeof data.d === "object" && data.d !== null ? data.d.t : data.d;
    if (typeof nonce !== "number" || !Number.isFinite(nonce)) return this.close(CLOSECODES.Decode_error);

    setHeartbeat(this);
    await Send(this, { op: VoiceOPCodes.HEARTBEAT_ACK, d: this.version >= 8 ? { t: nonce } : nonce });
}
