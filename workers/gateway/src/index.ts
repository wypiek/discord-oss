import { authorized } from "./auth";
import { type Env, type GatewayEvent, eventTarget } from "./hub";

export { GatewayHub } from "./hub";

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const hub = env.GATEWAY_HUB.getByName("gateway");
        if (request.headers.get("upgrade")?.toLowerCase() === "websocket") return hub.fetch(request);
        if (request.method === "POST") {
            if (!authorized(request, env.EVENT_SECRET)) return Response.json({ message: "Unauthorized" }, { status: 401 });
            if (new URL(request.url).pathname === "/config/reload") return Response.json(await hub.reloadConfig());
            const body = (await request.json().catch(() => undefined)) as GatewayEvent | GatewayEvent[] | undefined;
            const events = Array.isArray(body) ? body : body ? [body] : [];
            if (!events.length || events.some((event) => typeof event?.event !== "string" || !eventTarget(event)))
                return Response.json({ message: "Expected an event with an event name and a guild_id, channel_id, user_id or session_id" }, { status: 400 });
            const result = await hub.dispatch(events);
            return Response.json(result, { status: 202 });
        }
        if (request.method === "GET" && new URL(request.url).pathname === "/") return new Response("Online");
        return new Response("Not found", { status: 404 });
    },
} satisfies ExportedHandler<Env>;
