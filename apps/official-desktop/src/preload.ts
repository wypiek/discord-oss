import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("discordOss", {
    state: () => ipcRenderer.invoke("discord-oss:state"),
    discover: (input: string) => ipcRenderer.invoke("discord-oss:discover", input),
    switchTo: (instance: { url: string; name: string } | null) => ipcRenderer.invoke("discord-oss:switch", instance),
    forget: (url: string) => ipcRenderer.invoke("discord-oss:forget", url),
    close: () => ipcRenderer.send("discord-oss:close"),
});
