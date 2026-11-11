import { mediaServer, VoiceOPCodes, VoicePayload, WebRtcWebSocket, Send } from "../util";

// {"speaking":1,"delay":5,"ssrc":2805246727}

export async function relaySpeaking(socket: WebRtcWebSocket, speaking: number) {
    if (!socket.webRtcClient) return;
    await Promise.all(
        Array.from(mediaServer.getClientsForRtcServer<WebRtcWebSocket>(socket.webRtcClient.voiceRoomId)).map((client) => {
            if (client.user_id === socket.user_id) return Promise.resolve();

            const ssrc = client.getOutgoingStreamSSRCsForUser(socket.user_id).audio_ssrc;
            if (!ssrc) return Promise.resolve();

            return Send(client.websocket, {
                op: VoiceOPCodes.SPEAKING,
                d: {
                    user_id: socket.user_id,
                    speaking,
                    ssrc,
                },
            });
        }),
    );
}

export async function onSpeaking(this: WebRtcWebSocket, data: VoicePayload) {
    if (!this.webRtcClient) return;
    this.speaking = Number(data.d?.speaking) || 0;
    this.lastActivity = Date.now();
    await relaySpeaking(this, this.moderation?.mute ? 0 : data.d.speaking);
}
