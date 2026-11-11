import { Config } from "@spacebar/util";
import type { IGifProvider } from "./IGifProvider";
import KlipyGifProvider from "./providers/KlipyGifProvider";
import TenorGifProvider from "./providers/TenorGifProvider";

const PROVIDERS = [KlipyGifProvider, TenorGifProvider];

export class GifProviderManager {
    private static _providers: Map<string, IGifProvider> = new Map<string, IGifProvider>();
    public static async init() {
        if (!Config.get().integrations.gifs.enabled) {
            this._providers.clear();
            return;
        }
        const providers = new Map<string, IGifProvider>();
        console.log("[GifProviderManager] Initialising providers...");
        for (const Provider of PROVIDERS) {
            const provider: IGifProvider = new Provider();
            console.log(`[GifProviderManager] Got provider with id ${provider.id}, calling init...`);
            try {
                await provider.init();
            } catch {
                provider.available = false;
            }
            console.log(`[GifProviderManager] Initialized '${provider.id}' - Available:`, provider.available);
            if (provider.available) providers.set(provider.id, provider);
            console.log(`[GifProviderManager] Initialized`, providers.size, "/", PROVIDERS.length, "GIF providers...");
        }

        this._providers = providers;
        console.log("[GifProviderManager] Ready with", this._providers.size, "available providers!");
    }

    public static getProvider(id: string): IGifProvider {
        if (!Config.get().integrations.gifs.enabled) throw new Error("External GIF providers are disabled by instance policy");
        if (this._providers.has(id)) return this._providers.get(id)!;

        throw new Error(`Unknown GIF provider, or it is not enabled: ${id}, known GIF providers: ${Array.from(this._providers.keys()).join(", ")}`);
    }

    public static findProvider(id?: string): IGifProvider | undefined {
        if (!Config.get().integrations.gifs.enabled) return undefined;
        return this._providers.get(id || Config.get().integrations.gifs.defaultProvider);
    }

    public static getProviders() {
        if (!Config.get().integrations.gifs.enabled) return {};
        const providers: { [key: string]: { available: boolean } } = {};
        for (const [id, provider] of this._providers) {
            providers[id] = {
                available: provider.available,
            };
        }

        return providers;
    }
}
