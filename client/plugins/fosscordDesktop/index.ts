import definePlugin from "@utils/types";
import { FosscordAuthor } from "../fosscordCore/shared";
import { shareRecorder } from "./fosscordShare";
const appMedia = new Set<HTMLMediaElement>();
const tappedMedia = new WeakSet<HTMLMediaElement>();
let mediaTap: ((el: HTMLMediaElement) => void) | null = null;
function mixAppSounds(stream: MediaStream) {
    const context = new AudioContext();
    void context.resume();
    const out = context.createMediaStreamDestination();
    const [captured] = stream.getAudioTracks();
    if (captured) context.createMediaStreamSource(new MediaStream([captured])).connect(out);
    const taps = new WeakMap<HTMLMediaElement, AudioNode>();
    const tap = (el: HTMLMediaElement) => {
        if (el.srcObject || !stream.active) return;
        try {
            taps.get(el)?.disconnect();
            const media = (
                el as HTMLMediaElement & {
                    captureStream(): MediaStream;
                }
            ).captureStream();
            if (!media.getAudioTracks().length) return;
            const node = context.createMediaStreamSource(media);
            node.connect(out);
            taps.set(el, node);
        } catch {}
    };
    mediaTap = tap;
    appMedia.forEach((el) => {
        if (!el.paused) tap(el);
    });
    const [mixed] = out.stream.getAudioTracks();
    if (captured) stream.removeTrack(captured);
    stream.addTrack(mixed);
    stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        mediaTap = null;
        void context.close();
    });
}
export default definePlugin({
    name: "FosscordDesktop",
    description: "Makes the Discord desktop app use the browser voice engine, the only one Fosscord's voice server speaks.",
    authors: [FosscordAuthor],
    required: true,
    patches: [
        {
            find: ".DUMMY:default:return",
            replacement: {
                match: /\[(\i\.\i)\.NATIVE,(\i\.\i)\.WEBRTC\]\.find\((\i)=>(\i)\(\3\)\.supported\(\)\)/,
                replace: "[$1.NATIVE,$2.WEBRTC].find($3=>$4($3).supported()&&$self.allowEngine($3,$1.NATIVE))",
            },
        },
        {
            find: '"OculusBrowser")>-1',
            replacement: {
                match: /,(\i)="Chrome"===(\i)\(\)\.name\|\|"Safari"===\2\(\)\.name/,
                replace: ',$1="Electron"===$2().name||"Chrome"===$2().name||"Safari"===$2().name',
            },
        },
        {
            find: ".getMediaEngine().getDesktopSource(",
            replacement: [
                {
                    match: /\{if\(\i\.isPlatformEmbedded\)(\(0,\i\.openModalLazy\))/,
                    replace: "{if(!1)$1",
                },
                {
                    match: /(getDesktopSource\(\i,!0\)\.then\(\i=>\{\(0,\i\.\i\)\(\i,\i,\{pid:null,sourceId:\i,sourceName:)null/,
                    replace: "$1$self.pickedName()",
                },
            ],
        },
        {
            find: "Direct video streams are unavailable outside the native client",
            replacement: {
                match: /function (\i)\(\)\{return null!=\i\(\)\}/,
                replace: "function $1(){return!1}",
            },
        },
        {
            find: "startDavePreload(){",
            replacement: [
                { match: /fetchDave:\(0,\i\.isWeb\)\(\)/, replace: "fetchDave:!0" },
                {
                    match: /\(0,\i\.isWeb\)\(\)(&&\i\.fetchAsyncResources\(\{fetchDave:!0\}\))/,
                    replace: "!0$1",
                },
            ],
        },
        {
            find: ".DUMMY:default:return",
            replacement: {
                match: /function (\i)\((\i)\)\{return new\((\i)\(\2\)\)\}/,
                replace: 'function $1($2){return $self.withClips(new($3($2)),$3("NATIVE"))}',
            },
        },
    ],
    start() {
        if (!(window as any).DiscordNative || !(window as any).VencordNative?.pluginHelpers?.FosscordInstances?.writeClip) return;
        const play = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
            if (!this.srcObject) {
                if (appMedia.size >= 64) appMedia.clear();
                if (!tappedMedia.has(this)) {
                    tappedMedia.add(this);
                    appMedia.add(this);
                    this.addEventListener("playing", () => mediaTap?.(this));
                }
            }
            return play.call(this);
        };
        (window as any).__fosscordShareRecorder = shareRecorder;
        const devices = navigator.mediaDevices;
        const original = devices.getDisplayMedia.bind(devices);
        devices.getDisplayMedia = async (...args: Parameters<typeof original>) => {
            const options = args[0] as DisplayMediaStreamOptions | undefined;
            let wantsAudio = false;
            if (options?.audio) {
                const audio = options.audio === true ? {} : options.audio;
                args = [{ ...options, audio: { ...audio, restrictOwnAudio: true } } as DisplayMediaStreamOptions] as typeof args;
                wantsAudio = true;
            }
            const stream = await original(...args);
            if (wantsAudio)
                try {
                    mixAppSounds(stream);
                } catch {}
            try {
                shareRecorder.begin(stream);
            } catch {}
            return stream;
        };
    },
    pickedName() {
        return (
            (
                window as {
                    __fosscordPicked?: string;
                }
            ).__fosscordPicked ?? null
        );
    },
    allowEngine(engine: unknown, native: unknown) {
        return !(
            (
                window as {
                    DiscordNative?: unknown;
                }
            ).DiscordNative && engine === native
        );
    },
    withClips(engine: any, Native: any) {
        const proto = Native?.prototype;
        if (
            !(
                window as {
                    DiscordNative?: unknown;
                }
            ).DiscordNative ||
            !proto ||
            proto.hasClipsV3Support == null
        )
            return engine;
        const quiet = new Proxy({}, { get: () => () => {} });
        const stand = Object.assign(Object.create(proto), {
            clipsRecordingEventContext: { id: "", soundshareId: 0, applicationName: "" },
            clipsRecordingEventHandlerRegistered: false,
            logger: quiet,
            emit: (...args: unknown[]) => engine.emit(...args),
        });
        const clipFlags = new Set(["CLIPS", "CLIPS_RECORDING_READY_EVENTS"]);
        shareRecorder.onReady = (ready) => engine.emit("clips-recording-ready-changed", ready);
        shareRecorder.voices = () => {
            const me = (window as any).Vencord?.Webpack?.Common?.UserStore?.getCurrentUser?.()?.id;
            const voices: Array<{
                userId: string;
                track: MediaStreamTrack;
            }> = [];
            for (const connection of engine.connections ?? []) {
                if (connection.context !== "default") continue;
                for (const [userId, output] of Object.entries<any>(connection.outputs ?? {})) {
                    const track = output?.stream?.getAudioTracks?.()[0];
                    if (track) voices.push({ userId, track });
                }
                const mic = connection.input?.stream?.getAudioTracks?.()[0];
                if (mic && me) voices.push({ userId: me, track: mic });
            }
            return voices;
        };
        const own = new Set<string>();
        const overrides: Record<string, (...args: any[]) => unknown> = {
            async saveClipEx(request: { filepath: string; metadata: string }) {
                if (!shareRecorder.active()) return proto.saveClipEx.call(stand, request);
                const clip = await shareRecorder.save(request.filepath);
                own.add(request.filepath);
                try {
                    await proto.updateClipMetadata.call(stand, request.filepath, request.metadata);
                    const cut = Math.max(request.filepath.lastIndexOf("\\"), request.filepath.lastIndexOf("/"));
                    await (window as any).DiscordNative.clips.loadClipsDirectory(request.filepath.slice(0, cut));
                } catch {}
                return { duration: clip.duration, clipStats: { clipSizeBytes: clip.size } };
            },
            async updateClipMetadata(path: string, metadata: string) {
                try {
                    return await proto.updateClipMetadata.call(stand, path, metadata);
                } catch (e) {
                    if (!own.has(path)) throw e;
                }
            },
        };
        return new Proxy(engine, {
            get(target, prop) {
                if (typeof prop === "string") {
                    if (prop in overrides) return overrides[prop];
                    if (prop === "supports") return (flag: string) => (clipFlags.has(flag) ? proto.supports.call(stand, flag) : target.supports(flag));
                    if ((/clip/i.test(prop) || prop === "getSystemSteadyClockNowMs") && typeof proto[prop] === "function") return proto[prop].bind(stand);
                }
                return Reflect.get(target, prop, target);
            },
        });
    },
});
