import { fromBase64Url, isShimKey, restoreKey, type StoredKey, storeKey, toBase64Url } from "./subtle";

export type { Contact, StoredDevice, StoredIdentity, StoredPrekey } from "../../../e2ee/src/store";

export interface KeyValueBackend {
    name: string;
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
}

const PREFIX = "meowcord-e2ee";

let backend: KeyValueBackend | null = null;
const cache = new Map<string, unknown>();

export const useBackend = (next: KeyValueBackend) => {
    backend = next;
    cache.clear();
};

const required = () => {
    if (!backend) throw new Error("no durable storage for encryption keys");
    return backend;
};

export const encodeValue = (value: unknown) =>
    JSON.stringify(value, function (this: Record<string, unknown>, name: string, current: unknown) {
        const original = this[name];
        if (isShimKey(original)) return { $key: storeKey(original) };
        if (original instanceof Uint8Array) return { $bytes: toBase64Url(original) };
        return current;
    });

export const decodeValue = (text: string) =>
    JSON.parse(text, (_name, value: unknown) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return value;
        const record = value as { $key?: StoredKey; $bytes?: string };
        if (record.$key && Object.keys(record).length === 1) return restoreKey(record.$key);
        if (typeof record.$bytes === "string" && Object.keys(record).length === 1) return fromBase64Url(record.$bytes);
        return value;
    });

export const scoped = (userId: string) => {
    const key = (name: string) => `${PREFIX}:${userId}:${name}`;
    return {
        get: async <T>(name: string) => {
            const full = key(name);
            if (cache.has(full)) return cache.get(full) as T | undefined;
            const text = await required().get(full);
            const value = text == null ? undefined : (decodeValue(text) as T);
            cache.set(full, value);
            return value;
        },
        set: async <T>(name: string, value: T) => {
            const full = key(name);
            await required().set(full, encodeValue(value));
            cache.set(full, value);
            return full;
        },
        del: async (name: string) => {
            const full = key(name);
            await required().remove(full);
            cache.set(full, undefined);
            return undefined;
        },
    };
};

export type Store = ReturnType<typeof scoped>;

export const browserStorage = null;
export const tabStorage = null;

export const holdPendingPassword = async (_userId: string, _value: string) => {};

export const takePendingPassword = async (_userId: string, _ttl: number) => null as { value: string; at: number } | null;

export const dropPendingPassword = () => {};
