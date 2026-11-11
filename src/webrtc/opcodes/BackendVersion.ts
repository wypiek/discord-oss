import { VoiceOPCodes, VoicePayload, WebRtcWebSocket, Send } from "../util";

export async function onBackendVersion(this: WebRtcWebSocket, _: VoicePayload) {
    await Send(this, {
        op: VoiceOPCodes.VOICE_BACKEND_VERSION,
        d: { voice: "0.8.43", rtc_worker: "0.3.26" },
    });
}
