import { BrowserWindow, ipcMain, session, shell } from "electron";
import { join } from "node:path";
import { isHttpsHost, isSoundCloudUrl, soundCloudTrack } from "./music-tracks";
import type { MusicTrack } from "./music-types";

const HOME = "https://soundcloud.com/discover";
const PARTITION = "persist:soundcloud";
const SIGN_IN_HOSTS = ["accounts.google.com", "appleid.apple.com", "www.facebook.com", "m.facebook.com"];

const allowedInWindow = (url: string) => isSoundCloudUrl(url) || isHttpsHost(url, SIGN_IN_HOSTS);

const openOutside = (url: string) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
};

export const soundCloudSession = () => session.fromPartition(PARTITION);

interface SoundCloudOptions {
    icon: string;
    onTrack(track: MusicTrack | null): void;
}

export function createSoundCloudWindow({ icon, onTrack }: SoundCloudOptions) {
    let window: BrowserWindow | null = null;
    const partition = soundCloudSession();
    partition.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === "fullscreen"));
    partition.setPermissionCheckHandler(() => false);

    ipcMain.on("soundcloud:state", (event, state: unknown) => {
        if (!window || window.isDestroyed() || event.sender !== window.webContents || !isSoundCloudUrl(event.senderFrame?.url)) return;
        onTrack(soundCloudTrack(state));
    });

    return function open() {
        if (window && !window.isDestroyed()) {
            if (window.isMinimized()) window.restore();
            window.show();
            window.focus();
            return;
        }
        window = new BrowserWindow({
            width: 1100,
            height: 760,
            minWidth: 480,
            minHeight: 400,
            title: "SoundCloud",
            icon,
            backgroundColor: "#121212",
            autoHideMenuBar: true,
            webPreferences: {
                preload: join(__dirname, "soundcloud-preload.js"),
                partition: PARTITION,
                sandbox: true,
                contextIsolation: true,
                nodeIntegration: false,
                webSecurity: true,
                spellcheck: false,
            },
        });
        const contents = window.webContents;
        contents.on("will-navigate", (event, url) => {
            if (allowedInWindow(url)) return;
            event.preventDefault();
            openOutside(url);
        });
        contents.on("will-attach-webview", (event) => event.preventDefault());
        contents.setWindowOpenHandler(({ url }) => {
            if (allowedInWindow(url))
                return {
                    action: "allow",
                    overrideBrowserWindowOptions: {
                        autoHideMenuBar: true,
                        icon,
                        webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false },
                    },
                };
            openOutside(url);
            return { action: "deny" };
        });
        window.on("closed", () => {
            window = null;
            onTrack(null);
        });
        void window.loadURL(HOME);
    };
}
