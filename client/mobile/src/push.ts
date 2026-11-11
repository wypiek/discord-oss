import type { Endpoints } from "./rewrite";

export type UnifiedPushSubscription = { endpoint: string; keys: { p256dh: string; auth: string } };

export type UnifiedPushBridge = {
    register: (options: { instance: string; vapidKey: string }) => Promise<UnifiedPushSubscription | null>;
};

export const registerUnifiedPush = (endpoints: Endpoints, log: (message: string) => void) => {
    const api = `${endpoints.api.replace(/\/+$/, "").replace(/\/v\d+$/, "")}/v9`;
    const instance = endpoints.api.replace(/^(https?:\/\/[^/]+).*$/, "$1");
    const done = new Set<string>();
    let skipped = false;

    return (authorization: string) => {
        if (done.has(authorization)) return;
        const bridge = (globalThis as { __meowcordUnifiedPush?: UnifiedPushBridge }).__meowcordUnifiedPush;
        if (typeof bridge?.register !== "function" || typeof fetch !== "function") {
            if (!skipped) log("no UnifiedPush distributor bridge, skipping push registration");
            skipped = true;
            return;
        }
        done.add(authorization);
        const headers = { authorization, "content-type": "application/json" };
        setTimeout(async () => {
            try {
                const config = (await (await fetch(`${api}/users/@me/devices/web-push`, { headers })).json()) as { enabled?: boolean; public_key?: string };
                if (!config.enabled || !config.public_key) return log("the instance has Web Push turned off");
                const subscription = await bridge.register({ instance, vapidKey: config.public_key });
                if (!subscription?.endpoint) return log("no UnifiedPush distributor answered, skipping push registration");
                const body = JSON.stringify({ provider: "webpush", token: JSON.stringify({ endpoint: subscription.endpoint, keys: subscription.keys }) });
                const response = await fetch(`${api}/users/@me/devices`, { method: "POST", headers, body });
                log(`registered UnifiedPush endpoint, status ${response.status}`);
            } catch (error) {
                done.delete(authorization);
                log(`UnifiedPush registration failed: ${String(error)}`);
            }
        }, 0);
    };
};
