import { WebRtcWebSocket } from "@spacebar/webrtc";
import { VoiceSessions } from "../util/VoiceSessions";

export async function onClose(this: WebRtcWebSocket, code: number, reason: string) {
    console.log("[WebRTC] closed", code, reason.toString());
    clearTimeout(this.heartbeatTimeout);
    clearTimeout(this.readyTimeout);
    clearTimeout(this.authenticationTimeout);
    this.removeAllListeners();
    await VoiceSessions.onSocketClosed(this, code);
}
