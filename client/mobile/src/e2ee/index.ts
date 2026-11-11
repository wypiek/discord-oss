import type { Attachments } from "../../../e2ee/src/attachments";
import { randomBytes, toB64u } from "../../../e2ee/src/bytes";
import { aesDecrypt, aesEncrypt, exportPublic, generateAgreementKey, generateSigningKey, hpkeOpen, hpkeSeal, sign, verify } from "../../../e2ee/src/crypto";
import { type Api, Engine, errorText, type RawMessage } from "../../../e2ee/src/engine";
import type { Payload } from "../../../e2ee/src/files";
import { createHooks, type MessageState } from "../../../e2ee/src/hooks";
import { createLink, type LinkEvent } from "../../../e2ee/src/link";
import type { Dispatcher, FluxAction, GatewayStore, HttpClient } from "../../../e2ee/src/webpack";
import { knownAnswers } from "./kat";
import { findRandomSource } from "./random";
import { type KeyValueBackend, useBackend } from "./store";
import { createWebCrypto } from "./subtle";

type AnyRecord = Record<PropertyKey, any>;

export interface MobileE2eeOptions {
    api: string;
    trustServer: boolean;
    debug: boolean;
    log: (message: string) => void;
    nativeModule: (name: string) => AnyRecord | null;
}

interface ChannelStore {
    getChannel(id: string): { type?: number; e2ee_enabled?: boolean; e2ee_enabled_at?: string | null } | undefined;
}

const HOOK_TIMEOUT_MS = 60000;

const locale = () => {
    try {
        return Intl.DateTimeFormat().resolvedOptions().locale || "en-US";
    } catch {
        return "en-US";
    }
};

const keysOf = (value: unknown) => {
    try {
        return value && (typeof value === "object" || typeof value === "function") ? Object.keys(value) : [];
    } catch {
        return [];
    }
};

const protoKeysOf = (value: unknown) => {
    try {
        const proto = value && typeof value === "object" ? Object.getPrototypeOf(value) : null;
        return proto && proto !== Object.prototype ? Object.getOwnPropertyNames(proto) : [];
    } catch {
        return [];
    }
};

const ownValues = (exports: unknown) => {
    const values: unknown[] = [exports];
    if (!exports || (typeof exports !== "object" && typeof exports !== "function")) return values;
    for (const key of keysOf(exports)) {
        const descriptor = Object.getOwnPropertyDescriptor(exports, key);
        if (descriptor && "value" in descriptor && descriptor.value && typeof descriptor.value === "object") values.push(descriptor.value);
    }
    return values;
};

const fileBackend = (files: AnyRecord): KeyValueBackend | null => {
    if (typeof files.readFile !== "function" || typeof files.writeFile !== "function" || typeof files.removeFile !== "function" || typeof files.fileExists !== "function")
        return null;
    const constants = typeof files.getConstants === "function" ? files.getConstants() : files;
    const documents = constants?.DocumentsDirPath;
    if (typeof documents !== "string" || !documents) return null;
    const relative = (key: string) => `meowcord-e2ee/${key.replace(/[^A-Za-z0-9._-]/g, (char) => `~${char.charCodeAt(0).toString(16).padStart(2, "0")}`)}.json`;
    return {
        name: "NativeFileModule",
        get: async (key) => {
            const path = `${documents}/${relative(key)}`;
            if (!(await files.fileExists(path))) return null;
            return String(await files.readFile(path, "utf8"));
        },
        set: async (key, value) => {
            await files.writeFile("documents", relative(key), value, "utf8");
        },
        remove: async (key) => {
            if (await files.fileExists(`${documents}/${relative(key)}`)) await files.removeFile("documents", relative(key));
        },
    };
};

export const createMobileE2ee = (options: MobileE2eeOptions) => {
    const { log } = options;
    const g = globalThis as AnyRecord;
    const apiBase = `${options.api.replace(/\/+$/, "").replace(/\/v\d+$/, "")}/v9`;
    const shared: AnyRecord = (g.__meowcordE2ee ??= {});
    shared.document = { documentElement: { lang: locale() } };
    shared.navigator = { userAgent: "Discord Android", language: locale() };
    shared.addEventListener = () => {};

    const states = new Map<string, { state: MessageState; reason?: string }>();
    let token: string | null = null;
    let failure: string | null = null;
    let settle: (ok: boolean) => void = () => {};
    const ready = new Promise<boolean>((resolve) => {
        settle = resolve;
    });
    let readyNow = false;
    let started = false;
    let initialized = false;
    let loggedOut = false;
    let channelStore: ChannelStore | null = null;
    const found: { dispatcher?: Dispatcher; http?: HttpClient; gateway?: GatewayStore } = {};
    const installed = { dispatcher: false, http: false, gateway: false };
    const startedAt = Date.now();

    const api: Api = {
        async request<T>(method: "get" | "post" | "put" | "patch" | "del", url: string, body?: unknown) {
            if (!token) throw { ok: false, status: 401, body: { message: "not signed in yet" } };
            const res = await fetch(`${apiBase}${url}`, {
                method: method === "del" ? "DELETE" : method.toUpperCase(),
                headers: { authorization: token, "content-type": "application/json" },
                body: body === undefined ? undefined : JSON.stringify(body),
            });
            const text = await res.text();
            let parsed: unknown = null;
            try {
                parsed = text ? JSON.parse(text) : null;
            } catch {
                parsed = null;
            }
            if (!res.ok) throw { ok: false, status: res.status, body: parsed };
            return parsed as T;
        },
    };

    const classifyChannel = (channelId: string) => {
        const channel = channelStore?.getChannel(channelId);
        if (channel?.e2ee_enabled || channel?.e2ee_enabled_at) return true;
        return channel?.type === 1 || channel?.type === 3;
    };

    const engine = new Engine(api, classifyChannel, () => options.trustServer);

    const attachments = {
        start: () => {},
        ready: () => Promise.resolve(false),
        prepareCreate: () => {
            throw new Error("Files can't be encrypted in the Android app yet");
        },
        isUpload: () => false,
        prepareUpload: () => {
            throw new Error("Files can't be encrypted in the Android app yet");
        },
        uploaded: () => {},
        metaFor: () => null,
        sent: () => {},
        apply: (message: RawMessage, payload: Payload) => {
            message.content = payload.content;
            if (payload.stickers?.length) message.sticker_items = payload.stickers.map(({ id, name, format_type }) => ({ id, name, format_type }));
        },
        nameOf: () => undefined,
    } as unknown as Attachments;

    const link = createLink(engine, api, {
        onPrompt: (prompt) => {
            log(`device link request from ${prompt.name}, code ${prompt.sas}${prompt.autoApprove ? ", approving because it is signed in to this account" : ""}`);
            if (engine.trustsServer && prompt.autoApprove) prompt.approve().catch((error) => log(`automatic device approval failed: ${errorText(error)}`));
        },
        onChange: () => {
            const outgoing = link.outgoing();
            if (outgoing) log(`device link ${outgoing.state}${outgoing.approvers.length ? `, codes ${outgoing.approvers.map((a) => `${a.name} ${a.sas}`).join(", ")}` : ""}`);
        },
        onDismiss: () => {},
        onPeerUnlock: () => {
            if (initialized && engine.locked) engine.refresh().catch((error) => log(`refresh failed: ${errorText(error)}`));
        },
        onPeerReset: () => {
            if (initialized) engine.refresh().catch((error) => log(`refresh failed: ${errorText(error)}`));
        },
        beacon: (body) => {
            api.request("post", "/users/@me/e2ee/link", body).catch(() => {});
        },
    });

    const fail = (reason: string) => {
        if (failure) return;
        failure = reason;
        log(`encryption is off: ${reason}. Sending in encrypted conversations is refused.`);
        settle(false);
    };

    const signOut = () => {
        if (loggedOut) return;
        loggedOut = true;
        started = false;
        initialized = false;
        startAttempts = 0;
        link.stop();
        engine.forget().catch((error) => log(`couldn't remove this device's keys: ${errorText(error)}`));
    };

    const hooks = createHooks({
        fetchEmbeds: async () => ({}),
        fetchSoundmoji: async () => [],
        engine,
        attachments,
        sticker: () => null,
        ready,
        states,
        failClosed: () => failure !== null,
        isReady: () => readyNow,
        onLogout: () => signOut(),
        onCredentials: (path, body, response) => {
            const password = typeof body.password === "string" ? body.password : undefined;
            const next = typeof body.new_password === "string" ? body.new_password : undefined;
            const reply = response as { token?: unknown; user_id?: unknown } | null;
            if (typeof reply?.token === "string") token = reply.token;
            if (path !== "/users/@me") {
                if (password) log("kept the login password for the key backup");
                return password && engine.rememberPassword(password, typeof reply?.user_id === "string" ? reply.user_id : undefined);
            }
            if (next) engine.passwordChanged(password, next).catch((error) => log(`couldn't rewrap the backup: ${errorText(error)}`));
        },
        onState: () => {},
        updateRecord: () => {},
        onError: (error, channelId) => log(`message in ${channelId} wasn't sent: ${errorText(error)}`),
    });

    ready.then((ok) => {
        readyNow = ok;
        if (ok) hooks.retryAll();
    });

    const selfTest = async () => {
        const agreement = await generateAgreementKey();
        const secret = randomBytes(32);
        const sealed = await hpkeSeal(await exportPublic(agreement.publicKey), secret, "self-test", "aad");
        if (toB64u(await hpkeOpen(agreement, sealed.enc, sealed.wrapped, "self-test", "aad")) !== toB64u(secret)) throw new Error("HPKE round trip failed");
        const iv = randomBytes(12);
        const ct = await aesEncrypt(secret, iv, secret, "aad");
        if (toB64u(await aesDecrypt(secret, iv, ct, "aad")) !== toB64u(secret)) throw new Error("AES-GCM round trip failed");
        const signing = await generateSigningKey();
        const signature = await sign(signing.privateKey, "self-test");
        if (!(await verify(await exportPublic(signing.publicKey), "self-test", signature))) throw new Error("Ed25519 round trip failed");
        if (await verify(await exportPublic(signing.publicKey), "self-tesT", signature)) throw new Error("Ed25519 accepted a bad signature");
        const prekey = engine.prekeys.reduce((a, b) => (b.id > a.id ? b : a));
        const probe = await hpkeSeal(prekey.publicKey, secret, "self-test", "aad");
        if (toB64u(await hpkeOpen(prekey.keyPair, probe.enc, probe.wrapped, "self-test", "aad")) !== toB64u(secret)) throw new Error("Stored prekey round trip failed");
    };

    let platformReady = false;
    const preparePlatform = () => {
        if (platformReady) return;
        const random = findRandomSource(options.nativeModule);
        if (!random) throw new Error("no cryptographically secure random number generator in this app");
        log(`random numbers from ${random.describe}`);
        shared.crypto = createWebCrypto(random.source);
        const files = options.nativeModule("NativeFileModule");
        const backend = files && fileBackend(files);
        if (!backend) throw new Error("no durable storage for encryption keys in this app");
        useBackend(backend);
        log(`keys are stored through ${backend.name}`);
        platformReady = true;
        if (options.debug) setTimeout(() => knownAnswers(log, true).catch((error) => log(`known answer tests failed: ${errorText(error)}`)), 15000);
    };

    let startAttempts = 0;
    let listening = false;
    const finishStart = () => {
        if (engine.locked) {
            log("this device is locked, asking the account's other devices to approve it");
            link.request().catch((error) => log(`device link request failed: ${errorText(error)}`));
        }
        tick();
    };
    const start = async (userId: string) => {
        if (started || failure || loggedOut) return;
        started = true;
        const began = Date.now();
        try {
            try {
                preparePlatform();
            } catch (error) {
                return fail(errorText(error));
            }
            await engine.init(userId);
            await selfTest();
            initialized = true;
            log(
                `encryption ready in ${Date.now() - began} ms: device ${engine.device?.deviceId} ${engine.deviceStatus}, ${engine.linked ? "unlocked" : "locked"}, backup ${engine.backup ? engine.backup.mode : "none"}, ${engine.encryptedChannels.size} encrypted conversations`,
            );
            link.start(userId);
            if (listening) return finishStart();
            listening = true;
            engine.onUnlock(() => {
                log("this device is unlocked for encrypted messages");
                hooks.retryAll();
                if (engine.linked) {
                    link.cancel();
                    link.unlocked();
                }
            });
            engine.onWipe(() => {
                link.reset();
                if (engine.locked) link.request().catch(() => {});
            });
            let wasLinked = engine.linked;
            engine.onChange(() => {
                if (wasLinked && engine.locked) link.request().catch(() => {});
                wasLinked = engine.linked;
                link.devicesChanged();
            });
            finishStart();
        } catch (error) {
            const response = error as { status?: unknown; body?: { retry_after?: unknown } } | null;
            if (typeof response?.status !== "number") return fail(`self-test failed: ${errorText(error)}`);
            const retryAfter = Number(response.body?.retry_after);
            const delay = response.status === 429 && retryAfter > 0 ? Math.ceil(retryAfter) * 1000 + 1000 : Math.min(5000 * 2 ** startAttempts, 300000);
            startAttempts++;
            log(`encryption couldn't start (${errorText(error)}), retrying in ${Math.round(delay / 1000)}s`);
            setTimeout(() => {
                started = false;
                start(userId);
            }, delay);
        }
    };

    const startFromToken = () => {
        if (started || !token || loggedOut) return;
        api.request<{ id?: unknown }>("get", "/users/@me").then(
            (me) => {
                if (typeof me?.id === "string" && /^\d+$/.test(me.id)) start(me.id);
            },
            () => {},
        );
    };

    const custom = {
        E2EE_DEVICES_UPDATE: (data: Record<string, unknown>) => {
            engine.invalidateUser(String(data.user_id));
            if (String(data.user_id) === engine.userId && initialized) engine.refresh().catch((error) => log(`refresh failed: ${errorText(error)}`));
        },
        E2EE_IDENTITY_UPDATE: (data: Record<string, unknown>) => {
            const userId = String(data.user_id);
            engine.invalidateUser(userId);
            if (!initialized) return;
            if (userId === engine.userId) engine.refresh().catch((error) => log(`refresh failed: ${errorText(error)}`));
            else engine.keysFor([userId]).catch((error) => log(`couldn't check the new identity: ${errorText(error)}`));
        },
        E2EE_TRUST_UPDATE: () => {
            if (initialized) engine.syncTrust().catch((error) => log(`couldn't sync verifications: ${errorText(error)}`));
        },
        E2EE_LINK_REQUEST: (data: Record<string, unknown>) => {
            if (initialized) link.onEvent("E2EE_LINK_REQUEST", data as unknown as LinkEvent);
        },
        E2EE_LINK_RESPONSE: (data: Record<string, unknown>) => {
            if (initialized) link.onEvent("E2EE_LINK_RESPONSE", data as unknown as LinkEvent);
        },
        CHANNEL_E2EE_UPDATE: (data: Record<string, unknown>) => {
            if (data.enabled) engine.setChannelEncrypted(String(data.channel_id));
        },
    };

    let ticking = false;
    function tick() {
        ticking = false;
        if (failure) return;
        if (found.gateway && !installed.gateway) {
            try {
                if (found.gateway.getSocket()?.dispatcher?.getDispatchHandler) {
                    installed.gateway = true;
                    hooks.wrapGateway(found.gateway, custom);
                    log("hooked the gateway socket");
                }
            } catch (error) {
                log(`gateway hook failed: ${errorText(error)}`);
            }
        }
        if (installed.http && installed.dispatcher && initialized) {
            if (!installed.gateway) log("the gateway socket wasn't found, so messages decrypt after they show and device approval events are missed");
            return settle(true);
        }
        if (Date.now() - startedAt > HOOK_TIMEOUT_MS && !(installed.http && installed.dispatcher)) {
            const missing = Object.entries({ http: installed.http, dispatcher: installed.dispatcher })
                .filter(([, ok]) => !ok)
                .map(([name]) => name);
            return fail(`couldn't find ${missing.join(" and ")} in this app build`);
        }
        if (!started && token && Date.now() - startedAt > 8000) startFromToken();
        ticking = true;
        setTimeout(tick, installed.gateway ? 500 : 100);
    }

    const install = () => {
        if (found.http && !installed.http) {
            installed.http = true;
            hooks.wrapHttp(found.http);
            log("hooked the HTTP client");
        }
        if (found.dispatcher && !installed.dispatcher) {
            installed.dispatcher = true;
            const dispatcher = found.dispatcher;
            hooks.watchDispatcher(dispatcher);
            dispatcher.subscribe("LOGOUT", signOut);
            dispatcher.subscribe("CONNECTION_OPEN", (action: FluxAction) => {
                const user = action.user as { id?: string } | undefined;
                if (user?.id) start(user.id);
                else startFromToken();
            });
            dispatcher.subscribe("CHANNEL_RECIPIENT_ADD", (action: FluxAction) => engine.invalidateChannel(String(action.channelId)));
            dispatcher.subscribe("CHANNEL_RECIPIENT_REMOVE", (action: FluxAction) => engine.invalidateChannel(String(action.channelId)));
            log("hooked the dispatcher");
        }
        if (!ticking) tick();
    };

    const inspect = (exports: unknown, moduleId: unknown) => {
        if (found.dispatcher && found.http && found.gateway && channelStore) return;
        let changed = false;
        for (const value of ownValues(exports)) {
            if (!value || typeof value !== "object") continue;
            const own = keysOf(value);
            const proto = protoKeysOf(value);
            const all = new Set([...own, ...proto]);
            if (!found.dispatcher && ["addInterceptor", "dispatch", "subscribe"].every((key) => all.has(key))) {
                found.dispatcher = value as Dispatcher;
                changed = true;
                if (options.debug) log(`dispatcher in module ${String(moduleId)}`);
            } else if (
                !found.http &&
                own.length <= 6 &&
                (["get", "post", "put", "patch", "del"] as const).every((key) => own.includes(key) && typeof (value as AnyRecord)[key] === "function")
            ) {
                found.http = value as HttpClient;
                changed = true;
                if (options.debug) log(`HTTP client in module ${String(moduleId)}`);
            } else if (!found.gateway && proto.includes("getSocket") && proto.includes("isTryingToConnect")) {
                found.gateway = value as GatewayStore;
                changed = true;
                if (options.debug) log(`gateway store in module ${String(moduleId)}`);
            } else if (!channelStore && proto.includes("getChannel") && proto.includes("getDMFromUserId")) {
                channelStore = value as ChannelStore;
                if (options.debug) log(`channel store in module ${String(moduleId)}`);
            }
        }
        if (changed) install();
    };

    const onAuthorization = (value: string) => {
        if (value === token) return;
        token = value;
        loggedOut = false;
    };

    const status = () => ({
        ready: readyNow,
        failure,
        hooks: { ...installed, channelStore: !!channelStore },
        userId: engine.userId,
        deviceId: engine.device?.deviceId ?? null,
        deviceStatus: engine.deviceStatus,
        linked: engine.linked,
        backup: engine.backup?.mode ?? null,
        encryptedChannels: [...engine.encryptedChannels],
        states: Object.fromEntries(states),
    });

    return { inspect, onAuthorization, status, engine };
};
