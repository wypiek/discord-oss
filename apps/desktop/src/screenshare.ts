import { BrowserWindow, type DesktopCapturerSource, desktopCapturer, ipcMain, type Session } from "electron";
import { join } from "node:path";

interface PickedSource {
    id: string;
    audio: boolean;
}

const macMajorVersion = () => (process.platform === "darwin" ? Number(process.getSystemVersion().split(".")[0]) : 0);

export const systemAudioSupported = () => process.platform === "win32" || macMajorVersion() >= 13;

export const screenshareFeatureFlags = () => (process.platform === "darwin" ? ["MacLoopbackAudioForScreenShare", "MacSckSystemAudioLoopbackOverride"] : []);

let sources: DesktopCapturerSource[] = [];
let picker: BrowserWindow | null = null;
let settle: ((choice: PickedSource | null) => void) | null = null;

const fromPicker = (url: string | undefined) => !!url && url.startsWith("file:") && url.includes("/static/picker.html");

function finish(choice: PickedSource | null) {
    const done = settle;
    settle = null;
    done?.(choice);
    if (picker && !picker.isDestroyed()) picker.close();
    picker = null;
}

function choose(parent: BrowserWindow, preload: string, appRoot: string, audioRequested: boolean): Promise<PickedSource | null> {
    finish(null);
    return new Promise((resolve) => {
        settle = resolve;
        picker = new BrowserWindow({
            parent,
            modal: process.platform !== "linux",
            width: 760,
            height: 560,
            minWidth: 520,
            minHeight: 400,
            title: "Share your screen",
            backgroundColor: "#1a1a1e",
            autoHideMenuBar: true,
            show: false,
            webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false },
        });
        picker.once("ready-to-show", () => picker?.show());
        picker.on("closed", () => {
            picker = null;
            if (settle) finish(null);
        });
        picker.loadFile(join(appRoot, "static", "picker.html"), { query: { audio: audioRequested && systemAudioSupported() ? "1" : "0" } });
    });
}

export function registerScreenshare(session: Session, options: { allowed: (origin: string) => boolean; parent: () => BrowserWindow | null; preload: string; appRoot: string }) {
    ipcMain.handle("picker:sources", async (event) => {
        if (!fromPicker(event.senderFrame?.url)) return [];
        sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true });
        return sources.map((source) => ({
            id: source.id,
            name: source.name,
            kind: source.id.startsWith("screen:") ? "screen" : "window",
            thumbnail: source.thumbnail.isEmpty() ? null : source.thumbnail.toDataURL(),
            icon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : null,
        }));
    });
    ipcMain.on("picker:choose", (event, id: unknown, audio: unknown) => {
        if (!fromPicker(event.senderFrame?.url)) return;
        finish(typeof id === "string" ? { id, audio: audio === true } : null);
    });

    session.setDisplayMediaRequestHandler(
        (request, callback) => {
            const parent = options.parent();
            if (!parent || !options.allowed(request.securityOrigin)) return callback({});
            choose(parent, options.preload, options.appRoot, request.audioRequested)
                .then((choice) => {
                    const source = choice && sources.find((candidate) => candidate.id === choice.id);
                    if (!choice || !source) return callback({});
                    callback(choice.audio && systemAudioSupported() ? { video: source, audio: "loopback" } : { video: source });
                })
                .catch(() => callback({}));
        },
        { useSystemPicker: macMajorVersion() >= 15 },
    );
}
