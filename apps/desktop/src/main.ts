import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, session, shell, systemPreferences, Tray, type WebContents } from "electron";
import { join } from "node:path";
import { setOpenAtLogin, startedHidden } from "./autostart";
import { buildContextMenu } from "./context-menu";
import { discoverInstance, normalizeInstanceUrl } from "./discovery";
import { registerScreenshare, screenshareFeatureFlags } from "./screenshare";
import { forgetInstance, rememberInstance, saveSettings, settings, type WindowState } from "./store";

const PROTOCOL = "discord-oss";
const APP_ID = "org.discordoss.app";
const APP_NAME = "Discord OSS";
const appRoot = join(__dirname, "..");
const resource = (name: string) => join(appRoot, "resources", name);
const preload = join(__dirname, "preload.js");

const grantedPermissions = new Set([
    "media",
    "notifications",
    "clipboard-read",
    "clipboard-sanitized-write",
    "fullscreen",
    "display-capture",
    "pointerLock",
    "speaker-selection",
    "idle-detection",
]);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let pendingDeepLink: string | null = process.argv.find((arg) => arg.startsWith(`${PROTOCOL}://`)) ?? null;
let lastMentionCount = 0;

app.setName(APP_NAME);
if (process.platform === "win32") app.setAppUserModelId(APP_ID);
app.userAgentFallback = app.userAgentFallback.replace(/\s?Electron\/\S+/, "").replace(/\s?(Discord OSS|discord-oss-desktop)\/\S+/i, "");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("disable-features", "HardwareMediaKeyHandling,MediaSessionService");
app.commandLine.appendSwitch("enable-features", ["WebRTCPipeWireCapturer", ...screenshareFeatureFlags()].join(","));

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on("second-instance", (_event, argv) => {
        const link = argv.find((arg) => arg.startsWith(`${PROTOCOL}://`));
        if (link) openDeepLink(link);
        else showWindow();
    });
    app.on("open-url", (event, url) => {
        event.preventDefault();
        if (app.isReady()) openDeepLink(url);
        else pendingDeepLink = url;
    });
    if (process.defaultApp && process.argv[1]) app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [join(process.argv[1])]);
    else app.setAsDefaultProtocolClient(PROTOCOL);
    app.whenReady().then(start);
}

function instanceOrigins() {
    return new Set(settings().instances.map((instance) => instance.url));
}

function isInstanceUrl(url: string | undefined) {
    if (!url) return false;
    try {
        return instanceOrigins().has(new URL(url).origin);
    } catch {
        return false;
    }
}

const isAppPage = (url: string | undefined) => !!url && url.startsWith("file:") && url.includes("/static/");

function openExternal(url: string) {
    try {
        const protocol = new URL(url).protocol;
        if (protocol === "https:" || protocol === "http:" || protocol === "mailto:") shell.openExternal(url);
    } catch {}
}

function showWindow() {
    if (!mainWindow) return createWindow();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
}

function openSwitcher(prefill?: string) {
    if (!mainWindow) createWindow();
    mainWindow?.loadFile(join(appRoot, "static", "switcher.html"), prefill ? { query: { prefill } } : undefined);
    showWindow();
}

function openInstance(url: string, path = "/channels/@me") {
    if (!mainWindow) createWindow();
    mainWindow?.loadURL(new URL(path, url).toString());
    updateTrayMenu();
}

function openCurrent() {
    const current = settings().current;
    if (current && instanceOrigins().has(current)) openInstance(current);
    else openSwitcher();
}

function openDeepLink(link: string) {
    showWindow();
    let url: URL;
    try {
        url = new URL(link);
    } catch {
        return;
    }
    const requested = url.searchParams.get("instance");
    const path = url.host === "open" || url.host === "" ? url.searchParams.get("path") || "/channels/@me" : `/${url.host}${url.pathname}`;
    const safePath = path.startsWith("/") && !path.startsWith("//") ? path : "/channels/@me";
    if (requested) {
        let origin: string;
        try {
            origin = normalizeInstanceUrl(requested);
        } catch {
            return openSwitcher();
        }
        if (!instanceOrigins().has(origin)) return openSwitcher(origin);
        const saved = settings().instances.find((instance) => instance.url === origin);
        if (saved) rememberInstance(saved);
        return openInstance(origin, safePath);
    }
    const current = settings().current;
    if (current) openInstance(current, safePath);
    else openSwitcher();
}

function restoredBounds(state: WindowState) {
    const bounds = { width: Math.max(state.width, 940), height: Math.max(state.height, 560), x: state.x, y: state.y };
    if (bounds.x === undefined || bounds.y === undefined) return bounds;
    const visible = screen
        .getAllDisplays()
        .some(
            ({ workArea }) =>
                bounds.x! < workArea.x + workArea.width - 100 &&
                bounds.x! + bounds.width > workArea.x + 100 &&
                bounds.y! >= workArea.y - 20 &&
                bounds.y! < workArea.y + workArea.height - 100,
        );
    return visible ? bounds : { width: bounds.width, height: bounds.height };
}

function trackWindowState(window: BrowserWindow) {
    let timer: NodeJS.Timeout | undefined;
    const save = () => {
        if (window.isDestroyed() || window.isMinimized() || window.isFullScreen()) return;
        const maximized = window.isMaximized();
        saveSettings({ window: maximized ? { ...settings().window, maximized } : { ...window.getNormalBounds(), maximized } });
    };
    const later = () => {
        clearTimeout(timer);
        timer = setTimeout(save, 500);
    };
    window.on("resize", later);
    window.on("move", later);
    window.on("close", save);
}

function createWindow() {
    const state = settings().window;
    mainWindow = new BrowserWindow({
        ...restoredBounds(state),
        minWidth: 940,
        minHeight: 560,
        title: APP_NAME,
        icon: resource("icon.png"),
        backgroundColor: "#1a1a1e",
        autoHideMenuBar: true,
        show: false,
        webPreferences: {
            preload,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: true,
            spellcheck: true,
            backgroundThrottling: false,
        },
    });
    if (state.maximized) mainWindow.maximize();
    trackWindowState(mainWindow);
    secureContents(mainWindow.webContents);
    mainWindow.once("ready-to-show", () => {
        if (!startedHidden()) showWindow();
    });
    mainWindow.on("close", (event) => {
        if (quitting || !settings().closeToTray) return;
        event.preventDefault();
        mainWindow?.hide();
    });
    mainWindow.on("closed", () => {
        mainWindow = null;
    });
    mainWindow.on("focus", () => mainWindow?.flashFrame(false));
    mainWindow.webContents.on("page-title-updated", (event, title) => {
        event.preventDefault();
        mainWindow?.setTitle(title.replace(/^\(\d+\)\s*|^•\s*/, "") || APP_NAME);
        updateBadge(title);
    });
    mainWindow.webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
        if (!isMainFrame || code === -3 || !isInstanceUrl(url)) return;
        openSwitcher();
        mainWindow?.webContents.once("did-finish-load", () => mainWindow?.webContents.send("switcher:error", `Couldn't load ${new URL(url).host}: ${description}.`));
    });
    openCurrent();
}

function secureContents(contents: WebContents) {
    contents.on("will-navigate", (event, url) => {
        if (isAppPage(url) || isInstanceUrl(url)) return;
        event.preventDefault();
        openExternal(url);
    });
    contents.on("will-attach-webview", (event) => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
        if (url === "about:blank" || isInstanceUrl(url))
            return {
                action: "allow",
                overrideBrowserWindowOptions: {
                    autoHideMenuBar: true,
                    backgroundColor: "#1a1a1e",
                    icon: resource("icon.png"),
                    webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: true },
                },
            };
        openExternal(url);
        return { action: "deny" };
    });
    contents.on("context-menu", (_event, params) => buildContextMenu(contents, params)?.popup());
}

function updateBadge(title: string) {
    const mentions = Number(/^\((\d+)\)/.exec(title)?.[1] ?? 0);
    const unread = mentions > 0 || title.startsWith("•");
    if (process.platform === "darwin") app.dock?.setBadge(mentions > 0 ? String(mentions) : unread ? "•" : "");
    else if (process.platform === "linux") app.setBadgeCount(mentions);
    else mainWindow?.setOverlayIcon(mentions > 0 ? nativeImage.createFromPath(resource("badge.png")) : null, mentions > 0 ? `${mentions} unread mentions` : "");
    if (mentions > lastMentionCount && mainWindow && !mainWindow.isFocused()) mainWindow.flashFrame(true);
    lastMentionCount = mentions;
    tray?.setToolTip(mentions > 0 ? `${APP_NAME} (${mentions})` : APP_NAME);
}

function trayImage() {
    if (process.platform === "darwin") {
        const image = nativeImage.createFromPath(resource("trayTemplate.png"));
        image.setTemplateImage(true);
        return image;
    }
    return nativeImage.createFromPath(resource("tray.png"));
}

function switchTo(url: string) {
    const saved = settings().instances.find((instance) => instance.url === url);
    if (!saved) return;
    rememberInstance(saved);
    openInstance(saved.url);
    showWindow();
}

function instanceMenuItems(): Electron.MenuItemConstructorOptions[] {
    const { instances, current } = settings();
    return [
        ...instances.map((instance) => ({
            label: `${instance.name} (${new URL(instance.url).host})`,
            type: "radio" as const,
            checked: instance.url === current,
            click: () => switchTo(instance.url),
        })),
        ...(instances.length ? [{ type: "separator" as const }] : []),
        { label: "Add or Manage Instances…", accelerator: "CmdOrCtrl+Shift+O", click: () => openSwitcher() },
    ];
}

function updateTrayMenu() {
    if (!tray) return;
    tray.setContextMenu(
        Menu.buildFromTemplate([
            { label: `Open ${APP_NAME}`, click: showWindow },
            { type: "separator" },
            { label: "Switch Instance", submenu: instanceMenuItems() },
            { type: "separator" },
            {
                label: "Start at Login",
                type: "checkbox",
                checked: settings().openAtLogin,
                click: (item) => {
                    saveSettings({ openAtLogin: item.checked });
                    setOpenAtLogin(item.checked);
                },
            },
            {
                label: "Keep Running in the Tray",
                type: "checkbox",
                checked: settings().closeToTray,
                click: (item) => saveSettings({ closeToTray: item.checked }),
            },
            { type: "separator" },
            { label: `Quit ${APP_NAME}`, click: () => app.quit() },
        ]),
    );
    updateAppMenu();
}

function updateAppMenu() {
    const mac = process.platform === "darwin";
    Menu.setApplicationMenu(
        Menu.buildFromTemplate([
            ...(mac ? [{ role: "appMenu" as const }] : []),
            {
                label: "File",
                submenu: [
                    { label: "Switch Instance", submenu: instanceMenuItems() },
                    { type: "separator" },
                    mac ? { role: "close" } : { label: `Quit ${APP_NAME}`, click: () => app.quit() },
                ],
            },
            { role: "editMenu" },
            {
                label: "View",
                submenu: [
                    { role: "reload" },
                    { role: "forceReload" },
                    { role: "toggleDevTools" },
                    { type: "separator" },
                    { role: "resetZoom" },
                    { role: "zoomIn" },
                    { role: "zoomOut" },
                    { type: "separator" },
                    { role: "togglefullscreen" },
                ],
            },
            { role: "windowMenu" },
            {
                role: "help",
                submenu: [
                    {
                        label: "Open in Browser",
                        click: () => {
                            const current = settings().current;
                            if (current) shell.openExternal(current);
                        },
                    },
                ],
            },
        ]),
    );
}

function registerIpc() {
    const fromAppPage = (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) => isAppPage(event.senderFrame?.url);
    const fromInstance = (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) => isInstanceUrl(event.senderFrame?.url);

    ipcMain.handle("switcher:list", (event) => (fromAppPage(event) ? { instances: settings().instances, current: settings().current } : null));
    ipcMain.handle("switcher:discover", async (event, input: unknown) => {
        if (!fromAppPage(event) || typeof input !== "string") return { error: "Not allowed." };
        try {
            return { instance: await discoverInstance(input) };
        } catch (error) {
            return { error: error instanceof Error ? error.message : String(error) };
        }
    });
    ipcMain.handle("switcher:open", async (event, input: unknown) => {
        if (!fromAppPage(event) || typeof input !== "string") return { error: "Not allowed." };
        try {
            const instance = await discoverInstance(input);
            rememberInstance(instance);
            openInstance(instance.url);
            return { instance };
        } catch (error) {
            return { error: error instanceof Error ? error.message : String(error) };
        }
    });
    ipcMain.handle("switcher:remove", (event, url: unknown) => {
        if (!fromAppPage(event) || typeof url !== "string") return null;
        forgetInstance(url);
        updateTrayMenu();
        return { instances: settings().instances, current: settings().current };
    });
    ipcMain.on("app:focus", (event) => {
        if (fromInstance(event)) showWindow();
    });
    ipcMain.on("app:switcher", (event) => {
        if (fromInstance(event)) openSwitcher();
    });
}

function registerPermissions() {
    const defaultSession = session.defaultSession;
    defaultSession.setPermissionRequestHandler(async (_contents, permission, callback, details) => {
        if (!isInstanceUrl(details.requestingUrl) || !grantedPermissions.has(permission)) return callback(false);
        if (permission === "media" && process.platform === "darwin") {
            const types = "mediaTypes" in details ? (details.mediaTypes ?? []) : [];
            if (types.includes("audio")) await systemPreferences.askForMediaAccess("microphone");
            if (types.includes("video")) await systemPreferences.askForMediaAccess("camera");
        }
        callback(true);
    });
    defaultSession.setPermissionCheckHandler((_contents, permission, requestingOrigin) => isInstanceUrl(requestingOrigin) && grantedPermissions.has(permission));
    if (process.platform !== "darwin")
        defaultSession.setSpellCheckerLanguages(
            [app.getLocale(), "en-US"].filter((language, index, all) => all.indexOf(language) === index && defaultSession.availableSpellCheckerLanguages.includes(language)),
        );
    registerScreenshare(defaultSession, { allowed: isInstanceUrl, parent: () => mainWindow, preload, appRoot });
}

function start() {
    registerIpc();
    registerPermissions();
    if (settings().openAtLogin) setOpenAtLogin(true);
    tray = new Tray(trayImage());
    tray.setToolTip(APP_NAME);
    tray.on("click", showWindow);
    updateTrayMenu();
    createWindow();
    if (pendingDeepLink) {
        const link = pendingDeepLink;
        pendingDeepLink = null;
        mainWindow?.webContents.once("did-finish-load", () => openDeepLink(link));
    }
    app.on("activate", showWindow);
    app.on("web-contents-created", (_event, contents) => {
        if (contents.getType() === "window" && contents !== mainWindow?.webContents) secureContents(contents);
    });
}

app.on("before-quit", () => {
    quitting = true;
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});
