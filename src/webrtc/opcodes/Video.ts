import { Stream } from "@spacebar/database";
import { mediaServer, Send, VoiceOPCodes, VoicePayload, WebRtcWebSocket } from "@spacebar/webrtc";
import type { WebRtcClient } from "@spacebarchat/spacebar-webrtc-types";
import { validateSchema, VoiceVideoSchema } from "@spacebar/schemas";

const pendingVideo = new WeakMap<WebRtcClient<WebRtcWebSocket>, VoicePayload>();

function subscribeRoom(publisher: WebRtcWebSocket, voiceRoomId: string, type: "audio" | "video", subscribed: Set<WebRtcClient<WebRtcWebSocket>>) {
    const pending = [...mediaServer.getClientsForRtcServer<WebRtcWebSocket>(voiceRoomId)].filter(
        (client) => client.user_id !== publisher.user_id && !client.isSubscribedToTrack(publisher.user_id, type),
    );
    return Promise.all(
        pending.map(async (client) => {
            console.log(`[${client.user_id}] subscribing to ${type} of ${publisher.user_id}`);
            await client.subscribeToTrack(publisher.user_id, type);
            subscribed.add(client);
        }),
    );
}

export async function onVideo(this: WebRtcWebSocket, payload: VoicePayload) {
    if (!this.webRtcClient) return;

    const { voiceRoomId } = this.webRtcClient;

    const d = validateSchema("VoiceVideoSchema", payload.d) as VoiceVideoSchema;

    if (this.type === "stream") {
        const stream = await Stream.findOne({
            where: { id: voiceRoomId },
        });

        if (!stream) return;

        // only the stream owner can publish to a go live stream
        if (stream?.owner_id != this.user_id) {
            return;
        }
    }

    const stream = d.streams?.find((element) => element.active);

    const clientsThatNeedUpdate = new Set<WebRtcClient<WebRtcWebSocket>>();
    const wantsToProduceAudio = d.audio_ssrc !== 0;
    const wantsToProduceVideo = d.video_ssrc !== 0 && stream?.active;

    if (!this.webRtcClient.webrtcConnected) {
        if (!wantsToProduceAudio) return;
        const client = this.webRtcClient;
        const waiting = pendingVideo.has(client);
        pendingVideo.set(client, payload);
        if (waiting) return;
        client.emitter.once("connected", () => {
            const latest = pendingVideo.get(client);
            pendingVideo.delete(client);
            if (latest && this.webRtcClient === client)
                onVideo.call(this, latest).catch((error) => console.error(`[WebRTC] ${this.user_id} could not apply a queued video payload`, error));
        });
        return;
    }

    await Send(this, { op: VoiceOPCodes.MEDIA_SINK_WANTS, d: { any: 100 } });

    // first check if we need stop any tracks
    if (!wantsToProduceAudio && this.webRtcClient.isProducingAudio()) {
        this.webRtcClient.stopPublishingTrack("audio");
    }

    if (!wantsToProduceVideo && this.webRtcClient.isProducingVideo()) {
        this.webRtcClient.stopPublishingTrack("video");
    }

    // check if client has signaled that it will send audio
    if (wantsToProduceAudio) {
        // check if we are already producing audio, if not, publish a new audio track for it
        if (!this.webRtcClient!.isProducingAudio()) {
            console.log(`[${this.user_id}] publishing new audio track ssrc:${d.audio_ssrc}`);
            await this.webRtcClient.publishTrack("audio", {
                audio_ssrc: d.audio_ssrc,
            });
        }

        await subscribeRoom(this, voiceRoomId, "audio", clientsThatNeedUpdate);
    }
    // check if client has signaled that it will send video
    if (wantsToProduceVideo) {
        // TODO: fix spacebar-webrtc-types...
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        this.webRtcClient!.videoStream = { ...stream, type: "video" }; // client sends "screen" on go live but expects "video" on response
        // check if we are already publishing video, if not, publish a new video track for it
        if (!this.webRtcClient!.isProducingVideo()) {
            console.log(`[${this.user_id}] publishing new video track ssrc:${d.video_ssrc}`);
            await this.webRtcClient.publishTrack("video", {
                video_ssrc: d.video_ssrc,
                rtx_ssrc: d.rtx_ssrc,
            });
        }

        await subscribeRoom(this, voiceRoomId, "video", clientsThatNeedUpdate);
    }

    await Promise.all(
        Array.from(clientsThatNeedUpdate).map((client) => {
            const ssrcs = client.getOutgoingStreamSSRCsForUser(this.user_id);

            return Send(client.websocket, {
                op: VoiceOPCodes.VIDEO,
                d: {
                    user_id: this.user_id,
                    // can never send audio ssrc as 0, it will mess up client state for some reason. send server generated ssrc as backup
                    audio_ssrc: ssrcs.audio_ssrc ?? this.webRtcClient!.getIncomingStreamSSRCs().audio_ssrc,
                    video_ssrc: ssrcs.video_ssrc ?? 0,
                    rtx_ssrc: ssrcs.rtx_ssrc ?? 0,
                    streams: d.streams?.map((x) => ({
                        ...x,
                        ssrc: ssrcs.video_ssrc ?? 0,
                        rtx_ssrc: ssrcs.rtx_ssrc ?? 0,
                        type: "video",
                    })),
                } as VoiceVideoSchema,
            });
        }),
    );
}

// check if we are not subscribed to producers in this server, if not, subscribe
export async function subscribeToProducers(this: WebRtcWebSocket): Promise<void> {
    if (!this.webRtcClient || !this.webRtcClient.webrtcConnected) return;

    const clients = mediaServer.getClientsForRtcServer<WebRtcWebSocket>(this.webRtcClient.voiceRoomId);

    // a subscription made before this connection was up (everyone reconnects at once after a restart) missed the
    // keyframes asked for then, and a screenshare encoder may not send another for a long time: ask again
    for (const client of clients)
        if (client.user_id !== this.user_id && client.isProducingVideo())
            for (const delay of [250, 1000]) setTimeout(() => (client as { requestKeyframe?: () => void }).requestKeyframe?.(), delay);

    await Promise.all(
        Array.from(clients).map(async (client) => {
            let needsUpdate = false;

            if (client.user_id === this.user_id) return; // cannot subscribe to self

            if (client.isProducingAudio() && !this.webRtcClient!.isSubscribedToTrack(client.user_id, "audio")) {
                await this.webRtcClient!.subscribeToTrack(client.user_id, "audio");
                needsUpdate = true;
            }

            if (client.isProducingVideo() && !this.webRtcClient!.isSubscribedToTrack(client.user_id, "video")) {
                await this.webRtcClient!.subscribeToTrack(client.user_id, "video");
                needsUpdate = true;
            }

            if (!needsUpdate) return;

            const ssrcs = this.webRtcClient!.getOutgoingStreamSSRCsForUser(client.user_id);

            await Send(this, {
                op: VoiceOPCodes.VIDEO,
                d: {
                    user_id: client.user_id,
                    // can never send audio ssrc as 0, it will mess up client state for some reason. send server generated ssrc as backup
                    audio_ssrc: ssrcs.audio_ssrc ?? client.getIncomingStreamSSRCs().audio_ssrc,
                    video_ssrc: ssrcs.video_ssrc ?? 0,
                    rtx_ssrc: ssrcs.rtx_ssrc ?? 0,
                    streams: [
                        client.videoStream ?? {
                            type: "video",
                            rid: "100",
                            ssrc: ssrcs.video_ssrc ?? 0,
                            active: client.isProducingVideo(),
                            quality: 100,
                            rtx_ssrc: ssrcs.rtx_ssrc ?? 0,
                            max_bitrate: 2500000,
                            max_framerate: 20,
                            max_resolution: {
                                type: "fixed",
                                width: 1280,
                                height: 720,
                            },
                        },
                    ],
                } as VoiceVideoSchema,
            });
            const { speaking, moderation } = client.websocket;
            if (speaking && !moderation?.mute && ssrcs.audio_ssrc)
                await Send(this, {
                    op: VoiceOPCodes.SPEAKING,
                    d: { user_id: client.user_id, speaking, ssrc: ssrcs.audio_ssrc },
                });
        }),
    );
}
