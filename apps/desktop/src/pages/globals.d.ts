interface SavedInstance {
    url: string;
    name: string;
    icon: string | null;
    lastUsed: number;
}

interface InstanceResult {
    instance?: { url: string; name: string; icon: string | null };
    error?: string;
}

interface ScreenSource {
    id: string;
    name: string;
    kind: "screen" | "window";
    thumbnail: string | null;
    icon: string | null;
}

interface Window {
    discordOss: {
        platform: string;
        listInstances(): Promise<{ instances: SavedInstance[]; current: string | null } | null>;
        discoverInstance(url: string): Promise<InstanceResult>;
        openInstance(url: string): Promise<InstanceResult>;
        removeInstance(url: string): Promise<{ instances: SavedInstance[]; current: string | null } | null>;
        onError(listener: (message: string) => void): void;
        screenSources(): Promise<ScreenSource[]>;
        chooseScreenSource(id: string | null, audio: boolean): void;
    };
}
