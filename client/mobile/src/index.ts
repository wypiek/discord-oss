import "./e2ee/globals";
import { createMobileE2ee } from "./e2ee";
import { registerUnifiedPush } from "./push";
import { createRewriter, type Endpoints, endpointsFromOrigin, rewriteValue } from "./rewrite";

type AnyRecord = Record<PropertyKey, any>;
type Factory = (...args: any[]) => unknown;

const g = globalThis as AnyRecord;
const UNWRAPPED_MODULES = new Set(["NativeMediaEngineModule"]);
const URL_ATTRIBUTE = /^(?:src|source|sources|uri|url|defaultSource|loadingIndicatorSrc|poster|image|images)$/;

const log = (message: string) => {
    if (typeof g.nativeLoggingHook === "function") g.nativeLoggingHook(`[meowcord] ${message}`, 1);
};

type Settings = Endpoints & { debug?: boolean; e2eeTrustServer?: boolean };

const resolveEndpoints = (): Settings | null => {
    if (typeof g.__meowcordInstance === "string" && g.__meowcordInstance) return endpointsFromOrigin(g.__meowcordInstance);
    const injected: unknown = g.__meowcordEndpoints ?? "__MEOWCORD_ENDPOINTS__";
    if (typeof injected === "object" && injected) return injected as Settings;
    if (typeof injected !== "string" || !injected.startsWith("{")) return null;
    return JSON.parse(injected) as Settings;
};

const forwardingProxy = (target: AnyRecord, get: (key: PropertyKey) => unknown) =>
    new Proxy({} as AnyRecord, {
        get: (own, key) => (Object.hasOwn(own, key) ? own[key] : get(key)),
        has: (own, key) => key in own || key in target,
        ownKeys: (own) => [...new Set([...Reflect.ownKeys(own), ...Reflect.ownKeys(target)])],
        getOwnPropertyDescriptor: (own, key) => {
            if (Object.hasOwn(own, key)) return Reflect.getOwnPropertyDescriptor(own, key);
            return key in target ? { value: get(key), writable: true, enumerable: true, configurable: true } : undefined;
        },
    });

const start = () => {
    if (g.__meowcordInstalled) return;
    const endpoints = resolveEndpoints();
    if (!endpoints) return log("no instance configured, leaving the app untouched");
    g.__meowcordInstalled = true;
    g.__meowcordActiveEndpoints = endpoints;
    const debug = endpoints.debug === true;

    const baseRewrite = createRewriter(endpoints);
    let logged = 0;
    const rewrite = (url: string) => {
        const next = baseRewrite(url);
        if (debug && next !== url && logged < 100) {
            logged++;
            log(`${url.slice(0, 160)} -> ${next.slice(0, 160)}`);
        }
        return next;
    };

    const onAuthorization = registerUnifiedPush(endpoints, log);
    let registryGet: ((name: string) => unknown) | null = null;
    const nativeModule = (name: string) => {
        try {
            return (g.__turboModuleProxy?.(name) ?? g.nativeModuleProxy?.[name] ?? registryGet?.(name) ?? null) as AnyRecord | null;
        } catch {
            return null;
        }
    };
    const e2ee = createMobileE2ee({ api: endpoints.api, trustServer: endpoints.e2eeTrustServer !== false, debug, log, nativeModule });
    if (debug) {
        let last = "";
        setInterval(() => {
            const next = JSON.stringify(e2ee.status());
            if (next === last) return;
            last = next;
            log(`e2ee ${next.slice(0, 900)}`);
        }, 5000);
    }
    const watchAuthorization = (args: unknown[]) => {
        for (const arg of args) {
            if (!Array.isArray(arg)) continue;
            for (const header of arg) {
                if (Array.isArray(header) && typeof header[0] === "string" && header[0].toLowerCase() === "authorization" && typeof header[1] === "string") {
                    onAuthorization(header[1]);
                    e2ee.onAuthorization(header[1]);
                }
            }
        }
    };

    const wrappedModules = new WeakMap<object, unknown>();
    const changedMethods = new Set<string>();
    const wrapNativeModule = (name: string, mod: unknown) => {
        if (mod === null || typeof mod !== "object" || UNWRAPPED_MODULES.has(name)) return mod;
        const cached = wrappedModules.get(mod);
        if (cached) return cached;
        const source = mod as AnyRecord;
        const methods = new Map<PropertyKey, { original: unknown; wrapped: unknown }>();
        const proxy = forwardingProxy(source, (key) => {
            const value = source[key];
            if (typeof value !== "function") return value;
            const known = methods.get(key);
            if (known && known.original === value) return known.wrapped;
            const wrapped = (...args: unknown[]) => {
                if (name === "Networking") watchAuthorization(args);
                const next = rewriteValue(args, rewrite, 5);
                if (debug && next !== args && !changedMethods.has(`${name}.${String(key)}`)) {
                    changedMethods.add(`${name}.${String(key)}`);
                    log(`rewrote arguments of ${name}.${String(key)}`);
                }
                return value.apply(source, next);
            };
            methods.set(key, { original: value, wrapped });
            return wrapped;
        });
        wrappedModules.set(mod, proxy);
        return proxy;
    };

    const nativeModules = new Map<PropertyKey, unknown>();
    const nativeModulesProxy = g.nativeModuleProxy
        ? forwardingProxy(g.nativeModuleProxy, (key) => {
              if (typeof key !== "string") return g.nativeModuleProxy[key];
              if (!nativeModules.has(key)) nativeModules.set(key, wrapNativeModule(key, g.nativeModuleProxy[key]));
              return nativeModules.get(key);
          })
        : null;

    const patchedViewConfigs = new WeakMap<object, unknown>();
    const patchViewConfig = (name: string, config: AnyRecord | null | undefined) => {
        const attributes = config?.validAttributes;
        if (!attributes || typeof attributes !== "object") return config;
        const cached = patchedViewConfigs.get(config);
        if (cached) return cached;
        let changed: string[] | undefined;
        const nextAttributes: AnyRecord = { ...attributes };
        for (const key of Object.keys(attributes)) {
            if (!URL_ATTRIBUTE.test(key)) continue;
            const current = attributes[key];
            if (current !== true && (typeof current !== "object" || current === null || (typeof current.process !== "function" && typeof current.diff !== "function"))) continue;
            const process = typeof current === "object" && typeof current.process === "function" ? current.process : null;
            nextAttributes[key] = {
                ...(typeof current === "object" ? current : {}),
                process: (value: unknown) => rewriteValue(process ? process(value) : value, rewrite, 4),
            };
            (changed ??= []).push(key);
        }
        if (!changed) {
            patchedViewConfigs.set(config, config);
            return config;
        }
        if (debug) log(`view ${name}: ${changed.join(", ")}`);
        const next = { ...config, validAttributes: nextAttributes };
        patchedViewConfigs.set(config, next);
        return next;
    };

    const found = new Set<string>();
    const mark = (name: string) => {
        if (found.has(name)) return;
        found.add(name);
        log(`patched ${name}`);
    };
    const override = (exports: AnyRecord, values: AnyRecord) =>
        Object.create(exports, Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value, enumerable: true, writable: true, configurable: true }])));
    const patchExports = (exports: AnyRecord, moduleId: unknown) => {
        try {
            e2ee.inspect(exports, moduleId);
        } catch (error) {
            log(`e2ee module scan failed: ${String(error)}`);
        }
        if (exports === null || (typeof exports !== "object" && typeof exports !== "function")) return exports;
        if (nativeModulesProxy && exports === g.nativeModuleProxy) {
            mark("NativeModules");
            return nativeModulesProxy;
        }
        if (nativeModulesProxy && exports.default === g.nativeModuleProxy) {
            mark("NativeModules");
            return override(exports, { default: nativeModulesProxy });
        }
        const keys = Object.keys(exports).filter((key) => key !== "__esModule");
        if (keys.length === 2 && typeof exports.getEnforcing === "function" && typeof exports.get === "function") {
            mark("TurboModuleRegistry");
            const { get, getEnforcing } = exports;
            registryGet = (name: string) => get.call(exports, name);
            return override(exports, {
                get: (name: string) => wrapNativeModule(name, get.call(exports, name)),
                getEnforcing: (name: string) => wrapNativeModule(name, getEnforcing.call(exports, name)),
            });
        }
        if (typeof exports.register === "function" && typeof exports.get === "function" && "customBubblingEventTypes" in exports) {
            mark("ReactNativeViewConfigRegistry");
            const { get } = exports;
            return override(exports, { get: (name: string) => patchViewConfig(name, get.call(exports, name)) });
        }
        return exports;
    };

    const wrapFactory = (factory: Factory, moduleId: unknown): Factory =>
        function (this: unknown, ...args: any[]) {
            const result = factory.apply(this, args);
            const moduleObject = args[4];
            if (moduleObject && typeof moduleObject === "object") moduleObject.exports = patchExports(moduleObject.exports, moduleId);
            return result;
        };

    let define: Factory | undefined;
    const wrappedDefine = (factory: Factory, ...rest: unknown[]) => define?.(typeof factory === "function" ? wrapFactory(factory, rest[0]) : factory, ...rest);
    if (typeof g.__d === "function") {
        define = g.__d;
        log("__d already exists, modules defined before this bundle are not patched");
    }
    Object.defineProperty(g, "__d", {
        configurable: true,
        enumerable: true,
        get: () => (define ? wrappedDefine : undefined),
        set: (value: Factory) => {
            define = value;
        },
    });

    log(`api ${endpoints.api}, gateway ${endpoints.gateway}, cdn ${endpoints.cdn}, bridgeless ${g.RN$Bridgeless === true}`);
};

try {
    start();
} catch (error) {
    log(`failed to start: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
}
