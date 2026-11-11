import { MediaStreamAudioTrackSource, MediaStreamVideoTrackSource, Mp4OutputFormat, Output, StreamTarget } from "mediabunny";
const SEGMENT_MS = 30000;
const MAX_CLIP_BYTES = 64 * 1024 * 1024;
export interface Voice {
    userId: string;
    track: MediaStreamTrack;
}
interface Take {
    output: any;
    started: Promise<void>;
    cleanup: Array<() => void>;
    file: {
        data: Uint8Array;
        size: number;
    };
    startedAt: number;
}
export const shareRecorder = {
    stream: null as MediaStream | null,
    takes: [] as Take[],
    timer: 0 as unknown as ReturnType<typeof setInterval>,
    context: null as AudioContext | null,
    onReady: (_: boolean) => {},
    voices: (): Voice[] => [],
    active() {
        return this.stream != null && this.takes.length > 0;
    },
    begin(stream: MediaStream) {
        this.end();
        this.stream = stream;
        stream.getVideoTracks()[0]?.addEventListener("ended", () => this.stream === stream && this.end());
        this.open();
        let ticks = 0;
        this.timer = setInterval(() => (++ticks === 1 ? this.open() : this.rotate()), SEGMENT_MS);
        this.onReady(true);
    },
    open() {
        const stream = this.stream;
        const video = stream?.getVideoTracks()[0];
        if (!stream || !video) return;
        const file = { data: new Uint8Array(1 << 24), size: 0 };
        const output = new Output({
            format: new Mp4OutputFormat({ fastStart: "fragmented" }),
            target: new StreamTarget(
                new WritableStream({
                    write({ data, position }: { data: Uint8Array; position: number }) {
                        const end = position + data.length;
                        if (!Number.isSafeInteger(end) || position < 0 || end > MAX_CLIP_BYTES) {
                            shareRecorder.end();
                            throw new Error("Clip capacity exceeded");
                        }
                        if (end > file.data.length) {
                            const bigger = new Uint8Array(Math.max(end, file.data.length * 2));
                            bigger.set(file.data.subarray(0, file.size));
                            file.data = bigger;
                        }
                        file.data.set(data, position);
                        file.size = Math.max(file.size, end);
                    },
                }),
            ),
        });
        const take: Take = {
            output,
            started: Promise.resolve(),
            cleanup: [],
            file,
            startedAt: Date.now(),
        };
        const clones: MediaStreamTrack[] = [];
        const ownVideo = (track: typeof video) => {
            const copy = track.clone();
            clones.push(copy);
            return copy;
        };
        take.cleanup.push(() => clones.forEach((t) => t.stop()));
        output.addVideoTrack(new MediaStreamVideoTrackSource(ownVideo(video), { codec: "avc", bitrate: 4000000 }), { name: "video" });
        const audio = { codec: "aac" as const, bitrate: 128000 };
        const sources: Array<{
            name: string;
            track: MediaStreamTrack;
        }> = [];
        const app = stream.getAudioTracks()[0];
        if (app) sources.push({ name: "0:application", track: app });
        for (const v of this.voices().slice(0, 8)) if (v.track.readyState === "live") sources.push({ name: `${v.userId}:voice`, track: v.track });
        const context = (this.context ??= new AudioContext());
        void context.resume();
        const mix = context.createMediaStreamDestination();
        const steady = sources.map((s) => {
            const node = context.createMediaStreamSource(new MediaStream([s.track]));
            const out = context.createMediaStreamDestination();
            node.connect(out);
            node.connect(mix);
            take.cleanup.push(() => {
                node.disconnect();
                out.disconnect();
            });
            return { name: s.name, track: out.stream.getAudioTracks()[0] };
        });
        take.cleanup.push(() => mix.disconnect());
        output.addAudioTrack(new MediaStreamAudioTrackSource(mix.stream.getAudioTracks()[0], audio), {
            name: "0:all",
        });
        for (const s of steady) output.addAudioTrack(new MediaStreamAudioTrackSource(s.track, audio), { name: s.name });
        take.started = output.start().catch(() => {
            this.end();
        });
        this.takes.push(take);
    },
    rotate() {
        const old = this.takes.length > 1 ? this.takes.shift() : undefined;
        if (old) this.close(old);
        this.open();
    },
    close(take: Take) {
        take.started
            .then(() => take.output.cancel?.())
            .catch(() => {})
            .finally(() => take.cleanup.forEach((fn) => fn()));
    },
    end() {
        clearInterval(this.timer);
        for (const take of this.takes) this.close(take);
        this.takes = [];
        if (this.stream) this.onReady(false);
        this.stream = null;
        const context = this.context;
        this.context = null;
        void context?.close();
    },
    async save(filepath: string) {
        const take = this.takes[0];
        if (!take) throw new Error("nothing recorded");
        await take.started;
        if (take.file.size === 0) throw new Error("the recording hasn't written anything yet");
        const bytes = take.file.data.slice(0, take.file.size);
        const bridge = (window as any).VencordNative?.pluginHelpers?.FosscordInstances;
        if (!bridge?.writeClip) throw new Error("the Fosscord desktop bridge can't write clips");
        await bridge.writeClip(filepath, bytes);
        return { duration: Date.now() - take.startedAt, size: bytes.length };
    },
};
