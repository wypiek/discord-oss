import { randomBytes } from "node:crypto";
import { SelectProtocolSchema, validateSchema } from "@spacebar/schemas";
import { isNativeVoiceMode, nativeVoiceEnabled } from "@spacebar/util/util/NativeVoice";
import { mediaServer, Send, VoiceOPCodes, VoicePayload, WebRtcWebSocket } from "@spacebar/webrtc";
import type { Codec } from "@spacebarchat/spacebar-webrtc-types";
import { DAVE_PROTOCOL_VERSION, DaveSession } from "../dave/DaveSession";
import { onVideo } from "./Video";

type NativePayloadTypes = { audioPayloadType?: number; videoPayloadType?: number; rtxPayloadType?: number };
type NativeCapableClient = { useNativeTransport?: (ssrc: number, mode: string, key: Buffer, payloadTypes: NativePayloadTypes) => Promise<void> };

const UNKNOWN_ENCRYPTION_MODE = 4016;
const STREAM_KEYFRAME_INTERVAL_MS = 5000;

function nativePayloadTypes(codecs: SelectProtocolSchema["codecs"]): NativePayloadTypes {
    const find = (name: string) => codecs?.find((codec) => codec.name.toUpperCase() === name);
    const opus = find("OPUS");
    const h264 = find("H264");
    return { audioPayloadType: opus?.payload_type, videoPayloadType: h264?.payload_type, rtxPayloadType: h264?.rtx_payload_type };
}

async function selectWebRtc(socket: WebRtcWebSocket, data: SelectProtocolSchema) {
    const response = await mediaServer.onOffer(
        socket.webRtcClient!,
        data.sdp ?? (typeof data.data === "string" ? data.data : ""),
        (data.codecs ?? []).filter((codec): codec is Codec => ["opus", "VP8", "VP9", "H264"].includes(codec.name)),
    );
    socket.voiceProtocol = "webrtc";
    socket.daveVersion = Math.min(socket.maxDaveVersion, DAVE_PROTOCOL_VERSION);

    await Send(socket, {
        op: VoiceOPCodes.SESSION_DESCRIPTION,
        d: {
            video_codec: response.selectedVideoCodec,
            sdp: response.sdp,
            media_session_id: socket.session_id,
            audio_codec: "opus",
            dave_protocol_version: socket.daveVersion,
        },
    });
    return true;
}

async function selectUdp(socket: WebRtcWebSocket, data: SelectProtocolSchema) {
    const client = socket.webRtcClient as unknown as NativeCapableClient;
    if (!nativeVoiceEnabled() || typeof client.useNativeTransport !== "function") {
        socket.close(4000, "udp voice is not enabled on this instance");
        return false;
    }
    const mode = typeof data.data === "object" ? data.data.mode : data.mode;
    if (!isNativeVoiceMode(mode)) {
        socket.close(UNKNOWN_ENCRYPTION_MODE, "Unknown encryption mode");
        return false;
    }
    const ssrc = socket.webRtcClient!.getIncomingStreamSSRCs().audio_ssrc;
    if (!ssrc) {
        socket.close(4000, "no ssrc for this session");
        return false;
    }
    const key = randomBytes(32);
    await client.useNativeTransport(ssrc, mode, key, nativePayloadTypes(data.codecs));
    socket.voiceProtocol = "udp";
    socket.daveVersion = Math.min(socket.maxDaveVersion, DAVE_PROTOCOL_VERSION);

    await Send(socket, {
        op: VoiceOPCodes.SESSION_DESCRIPTION,
        d: {
            mode,
            secret_key: [...key],
            audio_codec: "opus",
            video_codec: "H264",
            media_session_id: socket.session_id,
            dave_protocol_version: socket.daveVersion,
            ...(socket.type === "stream" && { keyframe_interval: STREAM_KEYFRAME_INTERVAL_MS }),
        },
    });
    return true;
}

async function announce(socket: WebRtcWebSocket) {
    const { voiceRoomId } = socket.webRtcClient!;
    const others = [...mediaServer.getClientsForRtcServer<WebRtcWebSocket>(voiceRoomId)].filter((client) => client.user_id !== socket.user_id);

    if (others.length)
        await Send(socket, {
            op: VoiceOPCodes.CLIENTS_CONNECT,
            d: { user_ids: others.map((client) => client.user_id) },
        });

    await Promise.all(
        others.flatMap((client) => [
            Send(client.websocket, {
                op: VoiceOPCodes.CLIENTS_CONNECT,
                d: { user_ids: [socket.user_id] },
            }),
            Send(client.websocket, {
                op: VoiceOPCodes.CLIENT_FLAGS,
                d: { user_id: socket.user_id, flags: 0 },
            }),
            Send(client.websocket, {
                op: VoiceOPCodes.CLIENT_PLATFORM,
                d: { user_id: socket.user_id, platform: socket.clientPlatform ?? 0 },
            }),
            Send(socket, { op: VoiceOPCodes.CLIENT_FLAGS, d: { user_id: client.user_id, flags: 0 } }),
            Send(socket, {
                op: VoiceOPCodes.CLIENT_PLATFORM,
                d: { user_id: client.user_id, platform: client.websocket.clientPlatform ?? 0 },
            }),
        ]),
    );

    if (socket.daveVersion > 0) await DaveSession.get(voiceRoomId, socket.channel_id ?? voiceRoomId).join(socket);
}

export async function onSelectProtocol(this: WebRtcWebSocket, payload: VoicePayload) {
    if (!this.webRtcClient) return;

    const data = validateSchema("SelectProtocolSchema", payload.d) as SelectProtocolSchema;

    const selected = data.protocol === "udp" ? await selectUdp(this, data) : await selectWebRtc(this, data);
    if (!selected || !this.webRtcClient) return;

    await announce(this);

    if (this.voiceProtocol === "udp") {
        const audio_ssrc = this.webRtcClient.getIncomingStreamSSRCs().audio_ssrc ?? 0;
        await onVideo.call(this, { op: VoiceOPCodes.VIDEO, d: { audio_ssrc, video_ssrc: 0, rtx_ssrc: 0, streams: [] } });
    }
}
