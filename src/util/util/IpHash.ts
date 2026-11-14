import { constants, closeSync, fsyncSync, linkSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import path from "node:path";
import { createHmac, randomBytes } from "node:crypto";
import { ipGroup, plainIp } from "./IpGroups";

export const IP_HASH_PREFIX = "iph1_";
export const IP_FINGERPRINT_LENGTH = 10;
const IP_HASH_PATTERN = /^iph1_[A-Za-z0-9_-]{43}$/;
const MIN_SECRET_LENGTH = 32;
const CACHE_SIZE = 4096;

let secret: Buffer | undefined;
const cache = new Map<string, string>();

export const ipHashSecretFile = () => process.env.IP_HASH_SECRET_FILE?.trim() || path.join(path.dirname(path.resolve(process.env.CONFIG_PATH || "config.json")), ".ip-hash.key");

const usableSecret = (value: string, source: string) => {
    const trimmed = value.trim();
    if (trimmed.length < MIN_SECRET_LENGTH) throw new Error(`[IpHash] ${source} must hold at least ${MIN_SECRET_LENGTH} characters`);
    return Buffer.from(trimmed, "utf8");
};

function readSecretFile(filename: string) {
    const descriptor = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        return usableSecret(readFileSync(descriptor, "utf8"), filename);
    } finally {
        closeSync(descriptor);
    }
}

function createSecretFile(filename: string) {
    const temporary = `${filename}.${process.pid}.${randomBytes(12).toString("hex")}.tmp`;
    const descriptor = openSync(temporary, "wx", 0o600);
    try {
        writeSync(descriptor, `${randomBytes(32).toString("base64url")}\n`);
        fsyncSync(descriptor);
    } finally {
        closeSync(descriptor);
    }
    try {
        linkSync(temporary, filename);
        console.warn(`[IpHash] Generated a new IP hash secret in ${filename}. Back it up with the database: without it, stored IP hashes stop matching new requests.`);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    } finally {
        unlinkSync(temporary);
    }
}

function loadSecret() {
    const fromEnvironment = process.env.IP_HASH_SECRET;
    if (fromEnvironment?.trim()) return usableSecret(fromEnvironment, "IP_HASH_SECRET");
    const filename = ipHashSecretFile();
    try {
        return readSecretFile(filename);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    createSecretFile(filename);
    return readSecretFile(filename);
}

export function ipHashSecret() {
    secret ??= loadSecret();
    return secret;
}

export function resetIpHashSecret() {
    secret = undefined;
    cache.clear();
}

export const isIpHash = (value: unknown): value is string => typeof value === "string" && IP_HASH_PATTERN.test(value);

export function hashIpKey(key: string) {
    const cached = cache.get(key);
    if (cached) return cached;
    const hash = IP_HASH_PREFIX + createHmac("sha256", ipHashSecret()).update(key, "utf8").digest("base64url");
    if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!);
    cache.set(key, hash);
    return hash;
}

export function hashIp(value: unknown) {
    if (isIpHash(value)) return value;
    const ip = plainIp(value);
    return ip ? hashIpKey(ip) : null;
}

export function hashIpGroup(value: unknown) {
    const group = ipGroup(value);
    return group ? hashIpKey(group.key) : null;
}

export const ipFingerprint = (hash: string | null | undefined) => (isIpHash(hash) ? hash.slice(IP_HASH_PREFIX.length, IP_HASH_PREFIX.length + IP_FINGERPRINT_LENGTH) : null);

export const ipLabel = (value: unknown) => {
    if (isIpHash(value)) return ipFingerprint(value)!;
    const hash = hashIp(value);
    return hash ? ipFingerprint(hash)! : "unknown address";
};

export const redactAddress = <T>(value: T) => (typeof value === "string" && plainIp(value) ? `address ${ipLabel(value)}` : value);
