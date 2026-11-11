import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync } from "node:fs";
import { httpServerHandler } from "cloudflare:node";
import { databaseConfig } from "../../shared/config";
import { refuseRedirectsInFetch } from "../../shared/fetch";
import { runJobs } from "./jobs";
import { workersPublicFetch } from "./publicFetch";
import { r2Storage } from "./r2Storage";

export interface Env {
    HYPERDRIVE: Hyperdrive;
    GATEWAY?: Fetcher;
    MEDIA?: R2Bucket;
    EVENT_SECRET?: string;
    DB_POOL_SIZE?: string;
    FEDERATION_KEY?: string;
    JOBS_BUDGET_MS?: string;
    CONFIG_JSON?: string;
    CONFIG_OVERRIDE?: string;
    CONFIG_TTL_SECONDS?: string;
}

interface Pool {
    end(): Promise<void>;
    on(event: "error", listener: (error: Error) => void): unknown;
}

interface RequestDatabase {
    pool?: Pool;
    pending: Set<Promise<unknown>>;
}

refuseRedirectsInFetch();

const routingPort = 3001;
const requestDatabase = new AsyncLocalStorage<RequestDatabase>();
const handler = httpServerHandler({ port: routingPort });
let started: Promise<void> | undefined;
let refreshScamList: () => Promise<unknown> | undefined = () => undefined;
let refreshConfig: () => Promise<unknown> | undefined = () => undefined;
const backgroundLimit = 25_000;

const settle = async (scope: RequestDatabase) => {
    const deadline = Date.now() + backgroundLimit;
    while (scope.pending.size && Date.now() < deadline) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([Promise.allSettled([...scope.pending]), new Promise((resolve) => (timer = setTimeout(resolve, deadline - Date.now())))]);
        clearTimeout(timer);
    }
    if (scope.pending.size) console.warn(`[Background] ${scope.pending.size} tasks were still running after ${backgroundLimit} ms`);
};

const close = async (scope: RequestDatabase) => {
    await settle(scope);
    await scope.pool?.end().catch((error: Error) => console.warn("[Database] could not close the request pool", error.message));
};

const ready = (env: Env) => {
    started ??= start(env).catch((error) => {
        started = undefined;
        throw error;
    });
    return started;
};

const start = async (env: Env) => {
    process.env.DATABASE = env.HYPERDRIVE.connectionString;
    process.env.APPLY_DB_MIGRATIONS = "false";
    process.env.DATABASE_ENTITIES = "bundled";
    process.env.STORAGE_LOCATION ??= "/tmp/files";

    const { SpacebarServer } = await import("@spacebar/api/Server");
    const [database, util, schemas, validators] = await Promise.all([
        import("@spacebar/database"),
        import("@spacebar/util"),
        import("@spacebar/schemas"),
        import("../build/validators.js"),
    ]);
    schemas.usePrecompiledSchemas((validators.default ?? validators) as unknown as Parameters<typeof schemas.usePrecompiledSchemas>[0]);
    const routes = await import("../build/routes.js");

    const driver = database.DataSourceOptions.driver as unknown as { postgres: { Pool: new (options: object) => Pool } };
    let bootstrapPool: Pool | undefined;
    Object.defineProperty(driver, "master", {
        configurable: true,
        get() {
            const scope = requestDatabase.getStore();
            if (!scope) return bootstrapPool;
            if (!scope.pool) {
                scope.pool = new driver.postgres.Pool({
                    connectionString: env.HYPERDRIVE.connectionString,
                    max: Number(env.DB_POOL_SIZE) || 5,
                    connectionTimeoutMillis: 30000,
                });
                scope.pool.on("error", (error) => console.warn("[Database] pool error", error.message));
            }
            return scope.pool;
        },
        set(pool: Pool | undefined) {
            bootstrapPool = pool;
        },
    });

    await database.initDatabase();
    await bootstrapPool?.end();
    const config = databaseConfig(util.Config, () => database.ConfigEntity.count(), env);
    await config.load();
    await util.Config.init();
    refreshConfig = config.refreshIfStale;
    const saveConfig = util.Config.set.bind(util.Config);
    util.Config.set = (value) => {
        const saved = saveConfig(value);
        if (!saved) return saved;
        return saved.then((result) => {
            config.touch();
            if (env.GATEWAY)
                util.trackBackground(
                    env.GATEWAY.fetch("https://gateway.internal/config/reload", {
                        method: "POST",
                        headers: env.EVENT_SECRET ? { "x-event-secret": env.EVENT_SECRET } : {},
                    }).then(
                        (response) => response.ok || console.warn(`[Config] the gateway answered ${response.status} to a config reload`),
                        (error: Error) => console.warn("[Config] could not tell the gateway to reload the configuration:", error.message),
                    ),
                );
            return result;
        });
    };
    if (env.GATEWAY && !env.EVENT_SECRET) console.warn("[Events] EVENT_SECRET is not set, so the gateway refuses every event and config reload this worker sends");
    util.useEventWriter({
        init: async () => {},
        close: async () => {},
        emit: async (event) => {
            if (!env.GATEWAY) return;
            const response = await env.GATEWAY.fetch("https://gateway.internal/events", {
                method: "POST",
                headers: { "content-type": "application/json", ...(env.EVENT_SECRET ? { "x-event-secret": env.EVENT_SECRET } : {}) },
                body: JSON.stringify(event, util.JSONReplacer),
            }).catch((error: Error) => error);
            if (response instanceof Error) return console.warn(`[Events] could not reach the gateway for ${event.event}: ${response.message}`);
            if (!response.ok) console.warn(`[Events] the gateway answered ${response.status} to ${event.event}`);
        },
    });
    util.useBackgroundTracker((work) => {
        const scope = requestDatabase.getStore();
        if (!scope) return;
        const tracked: Promise<unknown> = work.catch(() => {}).finally(() => scope.pending.delete(tracked));
        scope.pending.add(tracked);
    });
    util.usePublicFetch(
        workersPublicFetch({
            allowPrivate: () => !!util.Config.get().security.allowPrivateNetworkRequests,
            isPrivateAddress: util.isPrivateAddress,
            isTrustedCdnAsset: util.isTrustedCdnAsset,
            timeoutError: (message, cause) => new util.PublicFetchError("timeout", message, cause),
        }),
    );
    if (env.FEDERATION_KEY) util.FederationKey.load(env.FEDERATION_KEY);
    const [{ deliverOnSchedule, forwardEvent }, { refreshScamListWhenDue }, { dispatchMessagePush }] = await Promise.all([
        import("@spacebar/api/util/utility/federationEvents"),
        import("@spacebar/api/util/utility/scamGuard"),
        import("@spacebar/api/util/utility/notifications"),
    ]);
    deliverOnSchedule();
    util.onEmitEvent((payload) => (payload.event === "MESSAGE_CREATE" && payload.channel_id ? dispatchMessagePush(payload.data) : undefined));
    util.onEmitEvent(forwardEvent);
    refreshScamList = refreshScamListWhenDue;
    await util.Email.init().catch((error: Error) => console.warn("[Email] not available:", error.message));
    const bundled = (routes.default ?? routes) as unknown as Parameters<typeof util.useBundledRoutes>[0] & {
        connections: Parameters<typeof util.useBundledConnections>[0];
        cdn: [string, unknown][];
    };
    util.useBundledConnections(bundled.connections);
    await util.ConnectionLoader.loadConnections();
    await util.JwtKeypairManager.init();
    util.WebAuthn.init();
    util.useBundledRoutes(bundled);
    const [{ GifProviderManager }, { initEmbeddedActivities }] = await Promise.all([import("@spacebar/integrations/gifs"), import("@spacebar/api/activities")]);
    await GifProviderManager.init();
    util.trackBackground(
        initEmbeddedActivities({ retryUploads: false }).catch((error: Error) => console.warn("[Activities] could not register the built in activities:", error.message)),
    );

    const server = new SpacebarServer({ port: routingPort, serverInitLogging: false });
    await server.mount();
    const [{ cdnResponseSafety }, { ErrorHandler: cdnErrorHandler }, { useStorage }] = await Promise.all([
        import("@spacebar/cdn/util/responseSafety"),
        import("@spacebar/cdn/util/ErrorHandler"),
        import("@spacebar/cdn/util/Storage"),
    ]);
    if (env.MEDIA) useStorage(r2Storage(env.MEDIA));
    const cdnRoot = "/bundle/dist/cdn/routes";
    server.app.use([...new Set(bundled.cdn.map(([file]) => `/${file.split("/")[0].replace(/\.js$/, "")}`))], cdnResponseSafety);
    for (const [file, loaded] of bundled.cdn) server.registerRoute(cdnRoot, `${cdnRoot}/${file}`, undefined, loaded);
    server.app.use(cdnErrorHandler);
    server.app.listen(routingPort);
};

const releaseDatabase = (scope: RequestDatabase, response: Response, ctx: ExecutionContext) => {
    const end = () => close(scope);
    if (!response.body) {
        ctx.waitUntil(Promise.resolve().then(end));
        return response;
    }
    const { readable, writable } = new TransformStream();
    ctx.waitUntil(response.body.pipeTo(writable).finally(end));
    return new Response(readable, response);
};

export default {
    fetch(request: Request<unknown, IncomingRequestCfProperties>, env: Env, ctx: ExecutionContext) {
        const scope: RequestDatabase = { pending: new Set() };
        return requestDatabase.run(scope, async () => {
            try {
                await ready(env);
                mkdirSync(process.env.STORAGE_LOCATION ?? "/tmp/files", { recursive: true });
                const refreshing = refreshScamList();
                if (refreshing) ctx.waitUntil(refreshing);
                await refreshConfig();
                return releaseDatabase(scope, await handler.fetch!(request, env, ctx), ctx);
            } catch (error) {
                ctx.waitUntil(close(scope));
                console.error("[API]", error);
                return Response.json({ message: "Internal Server Error", code: 0 }, { status: 500 });
            }
        });
    },
    scheduled(controller: ScheduledController, env: Env) {
        const scope: RequestDatabase = { pending: new Set() };
        return requestDatabase.run(scope, async () => {
            try {
                await ready(env);
                mkdirSync(process.env.STORAGE_LOCATION ?? "/tmp/files", { recursive: true });
                await refreshConfig();
                await runJobs(env, controller.cron, controller.scheduledTime);
            } finally {
                await close(scope);
            }
        });
    },
};
