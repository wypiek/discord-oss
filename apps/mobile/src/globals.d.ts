interface SavedInstance {
    url: string;
    name: string;
    icon: string | null;
    lastUsed: number;
}

interface Window {
    DiscordOSSAndroid?: {
        openInstance(url: string): void;
        removeInstance(url: string): void;
    };
}
