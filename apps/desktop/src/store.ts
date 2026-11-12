import { app } from "electron";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface SavedInstance {
    url: string;
    name: string;
    icon: string | null;
    lastUsed: number;
}

export interface WindowState {
    x?: number;
    y?: number;
    width: number;
    height: number;
    maximized: boolean;
}

export interface Settings {
    current: string | null;
    instances: SavedInstance[];
    window: WindowState;
    openAtLogin: boolean;
    closeToTray: boolean;
}

const defaults: Settings = {
    current: null,
    instances: [],
    window: { width: 1280, height: 800, maximized: false },
    openAtLogin: false,
    closeToTray: true,
};

let cache: Settings | null = null;

const settingsFile = () => join(app.getPath("userData"), "settings.json");

export function settings(): Settings {
    if (cache) return cache;
    try {
        const stored = JSON.parse(readFileSync(settingsFile(), "utf8")) as Partial<Settings>;
        cache = { ...defaults, ...stored, window: { ...defaults.window, ...stored.window }, instances: Array.isArray(stored.instances) ? stored.instances : [] };
    } catch {
        cache = structuredClone(defaults);
    }
    return cache;
}

export function saveSettings(patch: Partial<Settings>) {
    cache = { ...settings(), ...patch };
    const file = settingsFile();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, JSON.stringify(cache, null, 4));
    renameSync(`${file}.tmp`, file);
}

export function rememberInstance(instance: Omit<SavedInstance, "lastUsed">) {
    const others = settings().instances.filter((saved) => saved.url !== instance.url);
    saveSettings({ current: instance.url, instances: [{ ...instance, lastUsed: Date.now() }, ...others] });
}

export function forgetInstance(url: string) {
    const instances = settings().instances.filter((saved) => saved.url !== url);
    saveSettings({ instances, current: settings().current === url ? null : settings().current });
}
