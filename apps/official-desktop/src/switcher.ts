import { app, BrowserWindow, ipcMain, Menu, MenuItem, net, Tray, type WebContents } from "electron";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { backendSettings, currentInstance, discoverInstance, rememberInstance, type SavedInstance } from "./instances";

const ITEM_ID = "discord-oss-switch-instance";
declare const discordOssFolder: string;
const moduleFolder = discordOssFolder;
const settingsFile = () => join(app.getPath("userData"), "settings.json");
const instancesFile = () => join(app.getPath("userData"), "discord-oss-instances.json");
let switcher: BrowserWindow | null = null;

function readJson<T>(file: string, fallback: T): T {
    try {
        return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : fallback;
    } catch {
        return fallback;
    }
}

function writeJson(file: string, value: unknown) {
    writeFileSync(`${file}.discord-oss-tmp`, JSON.stringify(value, null, 2));
    renameSync(`${file}.discord-oss-tmp`, file);
}

function savedInstances(): SavedInstance[] {
    const list = readJson<SavedInstance[]>(instancesFile(), []);
    return Array.isArray(list) ? list.filter((item) => typeof item?.url === "string" && typeof item?.name === "string") : [];
}

function switchTo(instance: SavedInstance | null) {
    writeJson(settingsFile(), backendSettings(readJson<Record<string, unknown>>(settingsFile(), {}), instance?.url ?? null));
    if (instance) writeJson(instancesFile(), rememberInstance(savedInstances(), instance));
    app.relaunch();
    app.exit(0);
}

function openSwitcher() {
    if (switcher && !switcher.isDestroyed()) return switcher.focus();
    switcher = new BrowserWindow({
        width: 460,
        height: 600,
        resizable: false,
        minimizable: false,
        maximizable: false,
        title: "Switch instance",
        backgroundColor: "#1a1a1e",
        autoHideMenuBar: true,
        show: false,
        webPreferences: { preload: join(moduleFolder, "preload.js"), sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    switcher.setMenu(null);
    switcher.once("ready-to-show", () => switcher?.show());
    switcher.on("closed", () => {
        switcher = null;
    });
    switcher.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    switcher.webContents.on("will-navigate", (event) => event.preventDefault());
    void switcher.loadFile(join(moduleFolder, "switcher.html"));
}

const fromSwitcher = (sender: WebContents) => !!switcher && !switcher.isDestroyed() && sender === switcher.webContents;

ipcMain.handle("discord-oss:state", (event) => {
    if (!fromSwitcher(event.sender)) return null;
    return { current: currentInstance(readJson<Record<string, unknown>>(settingsFile(), {})), instances: savedInstances(), channel: app.getName() };
});
ipcMain.handle("discord-oss:discover", async (event, input: string) => {
    if (!fromSwitcher(event.sender)) throw new Error("Not allowed.");
    return discoverInstance(String(input), (url) => net.fetch(url, { headers: { accept: "application/json" } }));
});
ipcMain.handle("discord-oss:switch", (event, instance: SavedInstance | null) => {
    if (!fromSwitcher(event.sender)) return;
    switchTo(instance && typeof instance.url === "string" ? { url: instance.url, name: String(instance.name ?? instance.url) } : null);
});
ipcMain.handle("discord-oss:forget", (event, url: string) => {
    if (!fromSwitcher(event.sender)) return [];
    const list = savedInstances().filter((item) => item.url !== url);
    writeJson(instancesFile(), list);
    return list;
});
ipcMain.on("discord-oss:close", (event) => {
    if (fromSwitcher(event.sender)) switcher?.close();
});

const switchItem = () => new MenuItem({ id: ITEM_ID, label: "Switch instance…", accelerator: "CmdOrCtrl+Shift+O", click: openSwitcher });

function withSwitchItem(menu: Electron.Menu | null, prepend: boolean) {
    if (!menu || menu.getMenuItemById(ITEM_ID)) return menu;
    if (prepend) {
        menu.insert(0, new MenuItem({ type: "separator" }));
        menu.insert(0, switchItem());
    } else {
        menu.append(new MenuItem({ type: "separator" }));
        menu.append(switchItem());
    }
    return menu;
}

const setContextMenu = Tray.prototype.setContextMenu;
Tray.prototype.setContextMenu = function (this: Tray, menu: Electron.Menu | null) {
    return setContextMenu.call(this, withSwitchItem(menu, false));
};

const setApplicationMenu = Menu.setApplicationMenu;
Menu.setApplicationMenu = (menu: Electron.Menu | null) => {
    const appMenu = process.platform === "darwin" ? menu?.items[0]?.submenu : null;
    if (appMenu && !appMenu.getMenuItemById(ITEM_ID)) {
        appMenu.insert(1, new MenuItem({ type: "separator" }));
        appMenu.insert(1, switchItem());
    }
    return setApplicationMenu.call(Menu, menu);
};

app.on("browser-window-created", (_event, window) => {
    window.webContents.on("before-input-event", (event, input) => {
        if (input.type !== "keyDown" || !input.shift || input.alt || input.key.toLowerCase() !== "o") return;
        if (!(process.platform === "darwin" ? input.meta : input.control)) return;
        event.preventDefault();
        openSwitcher();
    });
});
