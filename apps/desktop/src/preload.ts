import { contextBridge, ipcRenderer, webFrame } from "electron";

if (location.protocol === "file:") {
    contextBridge.exposeInMainWorld("discordOss", {
        platform: process.platform,
        listInstances: () => ipcRenderer.invoke("switcher:list"),
        discoverInstance: (url: string) => ipcRenderer.invoke("switcher:discover", url),
        openInstance: (url: string) => ipcRenderer.invoke("switcher:open", url),
        removeInstance: (url: string) => ipcRenderer.invoke("switcher:remove", url),
        onError: (listener: (message: string) => void) => ipcRenderer.on("switcher:error", (_event, message: string) => listener(message)),
        screenSources: () => ipcRenderer.invoke("picker:sources"),
        chooseScreenSource: (id: string | null, audio: boolean) => ipcRenderer.send("picker:choose", id, audio),
    });
} else {
    contextBridge.exposeInMainWorld("DiscordOSS", {
        platform: process.platform,
        focusWindow: () => ipcRenderer.send("app:focus"),
        openInstanceSwitcher: () => ipcRenderer.send("app:switcher"),
    });
    webFrame.executeJavaScript(
        `(() => {
            const Native = window.Notification;
            if (!Native) return;
            class AppNotification extends Native {
                constructor(title, options) {
                    super(title, options);
                    this.addEventListener("click", () => window.DiscordOSS.focusWindow());
                }
            }
            Object.defineProperty(AppNotification, "permission", { get: () => Native.permission });
            AppNotification.requestPermission = Native.requestPermission.bind(Native);
            window.Notification = AppNotification;
        })();`,
    );
}
