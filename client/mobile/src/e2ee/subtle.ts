import { gcm } from "@noble/ciphers/aes.js";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256, sha384, sha512 } from "@noble/hashes/sha2.js";

export type RandomSource = (length: number) => Uint8Array;

type AlgorithmName = "Ed25519" | "X25519" | "AES-GCM" | "HMAC" | "HKDF";
type HashName = "SHA-256" | "SHA-384" | "SHA-512";
type KeyKind = "public" | "private" | "secret";
type AlgorithmInput = string | { name: string; [key: string]: unknown };
type Jwk = { kty?: string; crv?: string; x?: string; d?: string; k?: string; key_ops?: string[]; ext?: boolean; alg?: string };

interface Material {
    secret: Uint8Array | null;
    public: Uint8Array | null;
}

export interface StoredKey {
    type: KeyKind;
    name: AlgorithmName;
    hash?: HashName;
    length?: number;
    extractable: boolean;
    usages: string[];
    secret?: string;
    public?: string;
}

const NAMES: Record<string, AlgorithmName> = { ED25519: "Ed25519", X25519: "X25519", "AES-GCM": "AES-GCM", HMAC: "HMAC", HKDF: "HKDF" };
const HASHES = { "SHA-256": sha256, "SHA-384": sha384, "SHA-512": sha512 } as const;
const BLOCK_BITS: Record<HashName, number> = { "SHA-256": 512, "SHA-384": 1024, "SHA-512": 1024 };
const USAGES: Record<AlgorithmName, Record<KeyKind, string[]>> = {
    Ed25519: { private: ["sign"], public: ["verify"], secret: [] },
    X25519: { private: ["deriveBits", "deriveKey"], public: [], secret: [] },
    "AES-GCM": { private: [], public: [], secret: ["encrypt", "decrypt", "wrapKey", "unwrapKey"] },
    HMAC: { private: [], public: [], secret: ["sign", "verify"] },
    HKDF: { private: [], public: [], secret: ["deriveBits", "deriveKey"] },
};

const failure = (name: string, message: string) => Object.assign(new Error(message), { name });

const materials = new WeakMap<object, Material>();

export class ShimCryptoKey {
    constructor(
        readonly type: KeyKind,
        readonly extractable: boolean,
        readonly algorithm: { name: AlgorithmName; hash?: { name: HashName }; length?: number },
        readonly usages: string[],
    ) {}
}

const newKey = (type: KeyKind, extractable: boolean, algorithm: ShimCryptoKey["algorithm"], usages: string[], material: Material) => {
    const allowed = USAGES[algorithm.name][type];
    const kept = usages.filter((usage) => allowed.includes(usage));
    if (kept.length !== usages.length) throw failure("SyntaxError", `${algorithm.name} ${type} keys can't be used for ${usages.join(", ")}`);
    const key = new ShimCryptoKey(type, extractable, algorithm, kept);
    materials.set(key, { secret: material.secret?.slice() ?? null, public: material.public?.slice() ?? null });
    return key;
};

const materialOf = (key: unknown, name: AlgorithmName, usage?: string) => {
    const material = key && typeof key === "object" ? materials.get(key) : undefined;
    if (!material || !(key instanceof ShimCryptoKey)) throw failure("InvalidAccessError", "not a key from this crypto provider");
    if (key.algorithm.name !== name) throw failure("InvalidAccessError", `expected an ${name} key, got ${key.algorithm.name}`);
    if (usage && !key.usages.includes(usage)) throw failure("InvalidAccessError", `key usages don't include ${usage}`);
    return { key, material };
};

const algorithmName = (input: AlgorithmInput) => {
    const raw = typeof input === "string" ? input : input?.name;
    const name = typeof raw === "string" ? NAMES[raw.toUpperCase()] : undefined;
    if (!name) throw failure("NotSupportedError", `unsupported algorithm ${String(raw)}`);
    return name;
};

const hashName = (input: unknown): HashName => {
    const raw = typeof input === "string" ? input : (input as { name?: unknown } | undefined)?.name;
    const name = typeof raw === "string" ? raw.toUpperCase() : "";
    if (name in HASHES) return name as HashName;
    throw failure("NotSupportedError", `unsupported hash ${String(raw)}`);
};

const field = <T>(input: AlgorithmInput, name: string) => (typeof input === "object" ? (input[name] as T | undefined) : undefined);

const bytesOf = (data: unknown): Uint8Array => {
    if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    throw failure("TypeError", "expected an ArrayBuffer or a typed array");
};

const bufferOf = (bytes: Uint8Array) => new Uint8Array(bytes).buffer as ArrayBuffer;

const B64U = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export const toBase64Url = (bytes: Uint8Array) => {
    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
        const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
        out += B64U[(n >> 18) & 63] + B64U[(n >> 12) & 63];
        if (i + 1 < bytes.length) out += B64U[(n >> 6) & 63];
        if (i + 2 < bytes.length) out += B64U[n & 63];
    }
    return out;
};

export const fromBase64Url = (text: unknown) => {
    if (typeof text !== "string" || !/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) throw failure("DataError", "invalid base64url");
    const out = new Uint8Array(Math.floor((text.length * 3) / 4));
    let bits = 0;
    let value = 0;
    let index = 0;
    for (const char of text) {
        value = (value << 6) | B64U.indexOf(char);
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out[index++] = (value >> bits) & 255;
        }
    }
    return out;
};

const constantTimeEqual = (a: Uint8Array, b: Uint8Array) => {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
};

const sameBytes = (a: Uint8Array | null, b: Uint8Array | null) => !!a && !!b && constantTimeEqual(a, b);

const okpPublic = (name: "Ed25519" | "X25519", secret: Uint8Array) => (name === "Ed25519" ? ed25519.getPublicKey(secret) : x25519.getPublicKey(secret));

const checkLength = (bytes: Uint8Array, lengths: number[], what: string) => {
    if (!lengths.includes(bytes.length)) throw failure("DataError", `${what} must be ${lengths.join(" or ")} bytes`);
    return bytes;
};

const hmacLength = (hash: HashName, length: unknown) => {
    if (length === undefined) return BLOCK_BITS[hash];
    if (typeof length !== "number" || length <= 0 || length % 8) throw failure("NotSupportedError", "HMAC key length must be a positive multiple of 8");
    return length;
};

export const createSubtle = (random: RandomSource) => {
    const generateKey = async (algorithm: AlgorithmInput, extractable: boolean, usages: string[]) => {
        const name = algorithmName(algorithm);
        if (name === "Ed25519" || name === "X25519") {
            const secret = random(32);
            const material = { secret, public: okpPublic(name, secret) };
            const [privateUsages, publicUsages] = [USAGES[name].private, USAGES[name].public].map((allowed) => usages.filter((usage) => allowed.includes(usage)));
            if (privateUsages.length + publicUsages.length !== usages.length || (name === "Ed25519" && !privateUsages.length) || (name === "X25519" && !privateUsages.length))
                throw failure("SyntaxError", `invalid usages for ${name}`);
            return {
                privateKey: newKey("private", extractable, { name }, privateUsages, material),
                publicKey: newKey("public", true, { name }, publicUsages, { secret: null, public: material.public }),
            };
        }
        if (name === "AES-GCM") {
            const length = field<number>(algorithm, "length");
            if (length !== 128 && length !== 192 && length !== 256) throw failure("OperationError", "AES-GCM key length must be 128, 192 or 256");
            return newKey("secret", extractable, { name, length }, usages, { secret: random(length / 8), public: null });
        }
        if (name === "HMAC") {
            const hash = hashName(field(algorithm, "hash"));
            const length = hmacLength(hash, field(algorithm, "length"));
            return newKey("secret", extractable, { name, hash: { name: hash }, length }, usages, { secret: random(Math.ceil(length / 8)), public: null });
        }
        throw failure("NotSupportedError", `can't generate ${name} keys`);
    };

    const importKey = async (format: string, keyData: unknown, algorithm: AlgorithmInput, extractable: boolean, usages: string[]) => {
        const name = algorithmName(algorithm);
        if (name === "Ed25519" || name === "X25519") {
            if (format === "raw") return newKey("public", true, { name }, usages, { secret: null, public: checkLength(bytesOf(keyData), [32], `${name} public key`) });
            if (format !== "jwk") throw failure("NotSupportedError", `${format} keys aren't supported`);
            const jwk = keyData as Jwk;
            if (jwk?.kty !== "OKP" || jwk.crv !== name) throw failure("DataError", `expected an OKP ${name} JWK`);
            const publicKey = checkLength(fromBase64Url(jwk.x), [32], `${name} public key`);
            if (jwk.d === undefined) return newKey("public", true, { name }, usages, { secret: null, public: publicKey });
            const secret = checkLength(fromBase64Url(jwk.d), [32], `${name} private key`);
            if (!sameBytes(okpPublic(name, secret), publicKey)) throw failure("DataError", `${name} JWK public and private parts don't match`);
            return newKey("private", extractable, { name }, usages, { secret, public: publicKey });
        }
        let secret: Uint8Array;
        if (format === "raw") secret = bytesOf(keyData);
        else if (format === "jwk" && (keyData as Jwk)?.kty === "oct") secret = fromBase64Url((keyData as Jwk).k);
        else throw failure("NotSupportedError", `${format} keys aren't supported for ${name}`);
        if (name === "AES-GCM") return newKey("secret", extractable, { name, length: checkLength(secret, [16, 24, 32], "AES key").length * 8 }, usages, { secret, public: null });
        if (name === "HKDF") {
            if (format !== "raw" || extractable) throw failure("SyntaxError", "HKDF keys are raw and not extractable");
            return newKey("secret", false, { name }, usages, { secret, public: null });
        }
        const hash = hashName(field(algorithm, "hash"));
        if (!secret.length) throw failure("DataError", "HMAC key is empty");
        return newKey("secret", extractable, { name, hash: { name: hash }, length: secret.length * 8 }, usages, { secret, public: null });
    };

    const exportKey = async (format: string, key: ShimCryptoKey) => {
        const { material } = materialOf(key, key?.algorithm?.name);
        if (!key.extractable) throw failure("InvalidAccessError", "key is not extractable");
        const name = key.algorithm.name;
        if (format === "raw") {
            if (key.type === "public") return bufferOf(material.public!);
            if (key.type === "secret") return bufferOf(material.secret!);
            throw failure("InvalidAccessError", "private keys can't be exported raw");
        }
        if (format !== "jwk") throw failure("NotSupportedError", `${format} export isn't supported`);
        if (key.type === "secret") return { kty: "oct", k: toBase64Url(material.secret!), key_ops: [...key.usages], ext: true };
        return {
            kty: "OKP",
            crv: name,
            x: toBase64Url(material.public!),
            ...(key.type === "private" && { d: toBase64Url(material.secret!) }),
            key_ops: [...key.usages],
            ext: true,
        };
    };

    const sign = async (algorithm: AlgorithmInput, key: ShimCryptoKey, data: unknown) => {
        const name = algorithmName(algorithm);
        const { material } = materialOf(key, name, "sign");
        if (name === "Ed25519") return bufferOf(ed25519.sign(bytesOf(data), material.secret!));
        if (name === "HMAC") return bufferOf(hmac(HASHES[key.algorithm.hash!.name], material.secret!, bytesOf(data)));
        throw failure("NotSupportedError", `can't sign with ${name}`);
    };

    const verify = async (algorithm: AlgorithmInput, key: ShimCryptoKey, signature: unknown, data: unknown) => {
        const name = algorithmName(algorithm);
        const { material } = materialOf(key, name, "verify");
        const sig = bytesOf(signature);
        if (name === "Ed25519") {
            if (sig.length !== 64) return false;
            try {
                return ed25519.verify(sig, bytesOf(data), material.public!, { zip215: false });
            } catch {
                return false;
            }
        }
        if (name === "HMAC") return constantTimeEqual(hmac(HASHES[key.algorithm.hash!.name], material.secret!, bytesOf(data)), sig);
        throw failure("NotSupportedError", `can't verify with ${name}`);
    };

    const deriveBits = async (algorithm: AlgorithmInput, baseKey: ShimCryptoKey, length?: number | null) => {
        const name = algorithmName(algorithm);
        const { material } = materialOf(baseKey, name, "deriveBits");
        if (name === "X25519") {
            const peer = materialOf(field(algorithm, "public"), "X25519").material.public;
            if (!peer) throw failure("InvalidAccessError", "X25519 peer must be a public key");
            let shared: Uint8Array;
            try {
                shared = x25519.getSharedSecret(material.secret!, peer);
            } catch {
                throw failure("OperationError", "X25519 produced an all-zero secret");
            }
            if (shared.every((byte) => byte === 0)) throw failure("OperationError", "X25519 produced an all-zero secret");
            if (length == null) return bufferOf(shared);
            if (length > 256 || length % 8) throw failure("OperationError", "X25519 bit length must be a multiple of 8 up to 256");
            return bufferOf(shared.subarray(0, length / 8));
        }
        if (name === "HKDF") {
            if (typeof length !== "number" || length % 8 || length <= 0) throw failure("OperationError", "HKDF bit length must be a positive multiple of 8");
            const hash = hashName(field(algorithm, "hash"));
            return bufferOf(hkdf(HASHES[hash], material.secret!, bytesOf(field(algorithm, "salt")), bytesOf(field(algorithm, "info")), length / 8));
        }
        throw failure("NotSupportedError", `can't derive bits with ${name}`);
    };

    const aes = (algorithm: AlgorithmInput, key: ShimCryptoKey, usage: "encrypt" | "decrypt") => {
        if (algorithmName(algorithm) !== "AES-GCM") throw failure("NotSupportedError", "only AES-GCM is supported");
        const { material } = materialOf(key, "AES-GCM", usage);
        const tagLength = field<number>(algorithm, "tagLength") ?? 128;
        if (tagLength !== 128) throw failure("NotSupportedError", "only 128-bit AES-GCM tags are supported");
        const iv = bytesOf(field(algorithm, "iv"));
        if (!iv.length) throw failure("OperationError", "AES-GCM needs an IV");
        const aad = field(algorithm, "additionalData");
        return gcm(material.secret!, iv, aad === undefined ? undefined : bytesOf(aad));
    };

    const encrypt = async (algorithm: AlgorithmInput, key: ShimCryptoKey, data: unknown) => bufferOf(aes(algorithm, key, "encrypt").encrypt(bytesOf(data)));

    const decrypt = async (algorithm: AlgorithmInput, key: ShimCryptoKey, data: unknown) => {
        const cipher = aes(algorithm, key, "decrypt");
        try {
            return bufferOf(cipher.decrypt(bytesOf(data)));
        } catch {
            throw failure("OperationError", "AES-GCM authentication failed");
        }
    };

    const digest = async (algorithm: AlgorithmInput, data: unknown) => bufferOf(HASHES[hashName(algorithm)](bytesOf(data)));

    const unsupported = (operation: string) => async () => {
        throw failure("NotSupportedError", `${operation} isn't supported by this crypto provider`);
    };

    return {
        generateKey,
        importKey,
        exportKey,
        sign,
        verify,
        deriveBits,
        encrypt,
        decrypt,
        digest,
        deriveKey: unsupported("deriveKey"),
        wrapKey: unsupported("wrapKey"),
        unwrapKey: unsupported("unwrapKey"),
    };
};

export const createWebCrypto = (random: RandomSource) => ({
    subtle: createSubtle(random),
    getRandomValues: <T extends ArrayBufferView | null>(array: T): T => {
        if (!array || !ArrayBuffer.isView(array) || array instanceof Float32Array || array instanceof Float64Array || array instanceof DataView)
            throw failure("TypeMismatchError", "getRandomValues needs an integer typed array");
        if (array.byteLength > 65536) throw failure("QuotaExceededError", "getRandomValues takes at most 65536 bytes");
        new Uint8Array(array.buffer, array.byteOffset, array.byteLength).set(random(array.byteLength));
        return array;
    },
});

export const storeKey = (key: unknown): StoredKey => {
    if (!(key instanceof ShimCryptoKey)) throw failure("InvalidAccessError", "not a key from this crypto provider");
    const { material } = materialOf(key, key.algorithm.name);
    return {
        type: key.type,
        name: key.algorithm.name,
        ...(key.algorithm.hash && { hash: key.algorithm.hash.name }),
        ...(key.algorithm.length && { length: key.algorithm.length }),
        extractable: key.extractable,
        usages: [...key.usages],
        ...(material.secret && { secret: toBase64Url(material.secret) }),
        ...(material.public && { public: toBase64Url(material.public) }),
    };
};

export const restoreKey = (stored: StoredKey) => {
    const name = algorithmName(stored.name);
    const secret = stored.secret === undefined ? null : fromBase64Url(stored.secret);
    const publicKey = stored.public === undefined ? null : fromBase64Url(stored.public);
    if ((name === "Ed25519" || name === "X25519") && secret && (!publicKey || !sameBytes(okpPublic(name, secret), publicKey)))
        throw failure("DataError", "stored key doesn't match");
    return newKey(
        stored.type,
        stored.extractable,
        { name, ...(stored.hash && { hash: { name: hashName(stored.hash) } }), ...(stored.length && { length: stored.length }) },
        stored.usages,
        { secret, public: publicKey },
    );
};

export const isShimKey = (value: unknown): value is ShimCryptoKey => value instanceof ShimCryptoKey;
