import { GoLiveStreams, Stream } from "@spacebar/database";
import { parseStreamKey, Payload, WebSocket } from "@spacebar/gateway";

export async function onStreamSetPaused(this: WebSocket, { d }: Payload) {
    if (typeof d?.stream_key !== "string") return;
    const { channelId, userId } = parseStreamKey(d.stream_key);
    if (userId !== this.user_id) return;
    const stream = await Stream.findOne({ where: { channel_id: channelId, owner_id: userId } });
    if (stream) await GoLiveStreams.publishUpdate(stream.id, !!d.paused);
}
