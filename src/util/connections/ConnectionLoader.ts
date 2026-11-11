import { Config, Connection } from "@spacebar/util";
import fs from "node:fs";
import path from "node:path";
import { ConnectionConfig } from "./ConnectionConfig";
import { ConnectionStore } from "./ConnectionStore";
import { greenBright, redBright } from "picocolors";

const root = path.join(__dirname, "..", "..", "connections");
let connectionsLoaded = false;
type ConnectionModule = { default: new () => Connection };
let bundledConnections: ConnectionModule[] | undefined;

export function useBundledConnections(modules: ConnectionModule[]) {
    bundledConnections = modules;
}

export class ConnectionLoader {
    public static async loadConnections() {
        if (connectionsLoaded) return;
        await ConnectionConfig.init();
        const modules =
            bundledConnections ??
            fs
                .readdirSync(root)
                .filter((x) => {
                    try {
                        fs.readdirSync(path.join(root, x));
                        return true;
                    } catch (e) {
                        return false;
                    }
                })
                .map((x) => require(path.resolve(path.join(root, x))) as ConnectionModule);

        modules.forEach((module) => {
            const mod = new module.default();
            ConnectionStore.connections.set(mod.id, mod);

            mod.init();
            console.log(`[Connections] Loaded connection '${mod.id}' (${mod.friendlyName}) -`, mod.settings.enabled ? greenBright("enabled") : redBright("disabled"));
            if (mod.settings.enabled && !mod.isConfigured) {
                console.log(`[Connections/${mod.id}] Connection is enabled, but not configured! Users will not be able to successfully link with ${mod.friendlyName}!`);
                if (mod.requiredScopes.length > 0) {
                    console.log(`[Connections/${mod.id}] Configuring this connection requires setting scopes, or has additional requirements:`);
                    for (const scope in mod.requiredScopes) console.log(`[Connections/${mod.id}]   - ${scope}`);
                    console.log(`[Connections/${mod.id}] You can obtain the required credentials here: ${mod.setupUrl}`);
                }
            }
        });
        connectionsLoaded = true;
    }

    public static getConnectionConfig<T>(id: string, defaults?: unknown): T {
        let cfg = ConnectionConfig.get()[id];
        if (defaults) {
            if (cfg) cfg = Object.assign({}, defaults, cfg);
            else {
                cfg = defaults;
                this.setConnectionConfig(id, cfg).catch((e) => console.error(`[Connections/ERROR] Failed to set default config for '${id}'!`, e));
            }
        }

        // if (!cfg)
        // 	console.log(
        // 		`[ConnectionConfig/WARN] Getting connection settings for '${id}' returned null! (Did you forget to add settings?)`,
        // 	);
        if (cfg && typeof cfg === "object") {
            return new Proxy(cfg, {
                get(target, property, receiver) {
                    if (property === "enabled" && !Config.get().externalRequests.thirdParty) return false;
                    return Reflect.get(target, property, receiver);
                },
            }) as T;
        }
        return cfg;
    }

    public static async setConnectionConfig(id: string, config: Partial<unknown>): Promise<void> {
        if (!config) console.warn(`[Connections/WARN] ${id} tried to set config=null!`);

        await ConnectionConfig.set({
            [id]: Object.assign({}, ConnectionConfig.get()[id] || {}, config),
        });
    }
}
