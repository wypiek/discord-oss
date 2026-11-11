import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, hkdfSync, randomBytes, timingSafeEqual, verify } from "node:crypto";
import { E2eeKeyBackup, E2eeRecovery } from "@spacebar/database";
import { HTTPError } from "lambert-server/HTTPError";

type RecoveryBackup = Pick<E2eeKeyBackup, "identity_key" | "wrapped_identity" | "backup_public_key" | "backup_key_signature" | "wrapped_backup_key">;

const unavailable = () => new HTTPError("Account recovery is temporarily unavailable", 503);
const invalid = () => new HTTPError("Invalid account recovery data", 400);
const decode = (value: string, length?: number) => {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > 32_768) throw invalid();
    const decoded = Buffer.from(value, "base64url");
    if (decoded.toString("base64url") !== value || (length !== undefined && decoded.length !== length)) throw invalid();
    return decoded;
};
const keyMaterial = (value: string) => {
    const key = value.trim();
    return /^[0-9a-fA-F]{64}$/.test(key) ? Buffer.from(key, "hex") : decode(key, 32);
};
const keyFile = () => process.env.E2EE_RECOVERY_KEY_FILE || path.join(path.dirname(path.resolve(process.env.CONFIG_PATH || "config.json")), ".e2ee-recovery.key");

const readMasterFile = async (filename: string) => {
    const file = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const stat = await file.stat();
        if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 128) throw unavailable();
        return keyMaterial((await file.readFile("utf8")).trim());
    } finally {
        await file.close();
    }
};

const loadMaster = async () => {
    if (process.env.E2EE_RECOVERY_MASTER_KEY?.trim()) return keyMaterial(process.env.E2EE_RECOVERY_MASTER_KEY);
    const filename = keyFile();
    try {
        return await readMasterFile(filename);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw unavailable();
    }
    if ((await E2eeRecovery.count()) > 0) throw unavailable();
    const temporary = `${filename}.${process.pid}.${randomBytes(12).toString("hex")}.tmp`;
    let file;
    try {
        file = await fs.open(temporary, "wx", 0o600);
        await file.writeFile(`${randomBytes(32).toString("base64url")}\n`, "utf8");
        await file.sync();
        await file.close();
        file = undefined;
        try {
            await fs.link(temporary, filename);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
        const directory = await fs.open(path.dirname(filename), constants.O_RDONLY);
        try {
            await directory.sync();
        } finally {
            await directory.close();
        }
        return await readMasterFile(filename);
    } finally {
        if (file) await file.close().catch(() => undefined);
        await fs.unlink(temporary).catch(() => undefined);
    }
};

let master: Promise<Buffer> | undefined;
const recoveryMaster = () => {
    if (!master) {
        master = loadMaster().catch(() => {
            master = undefined;
            throw unavailable();
        });
    }
    return master;
};

const account = (userId: string, identityKey: string) => {
    if (typeof userId !== "string" || !/^[0-9]{1,20}$/.test(userId)) throw invalid();
    decode(identityKey, 32);
};
const aad = (userId: string, identityKey: string, backupPublicKey: string) => {
    account(userId, identityKey);
    decode(backupPublicKey, 32);
    return Buffer.from(`fosscord-e2ee/v1/server-recovery-secret\n${userId}\n${identityKey}\n${backupPublicKey}`, "utf8");
};
const encrypt = (key: Buffer, plaintext: Buffer, binding: Buffer) => {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(binding);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString("base64url");
};
const decrypt = (key: Buffer, box: string, binding: Buffer) => {
    const bytes = decode(box);
    if (bytes.length < 28) throw invalid();
    const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
    decipher.setAAD(binding);
    decipher.setAuthTag(bytes.subarray(-16));
    return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]);
};

export async function sealRecoverySecret(userId: string, identityKey: string, backupPublicKey: string, secret: string): Promise<string> {
    const binding = aad(userId, identityKey, backupPublicKey);
    const bytes = decode(secret, 32);
    try {
        return `v1.${encrypt(await recoveryMaster(), bytes, binding)}`;
    } finally {
        bytes.fill(0);
    }
}

export async function openRecoverySecret(userId: string, identityKey: string, backupPublicKey: string, sealed: string): Promise<string> {
    try {
        const binding = aad(userId, identityKey, backupPublicKey);
        if (typeof sealed !== "string" || !sealed.startsWith("v1.") || sealed.length > 128) throw unavailable();
        const bytes = decrypt(await recoveryMaster(), sealed.slice(3), binding);
        if (bytes.length !== 32) throw unavailable();
        try {
            return bytes.toString("base64url");
        } finally {
            bytes.fill(0);
        }
    } catch {
        throw unavailable();
    }
}

const privateKeyFromBox = (secret: Buffer, userId: string, label: string, box: string, curve: "Ed25519" | "X25519", expectedPublic: string) => {
    const derived = Buffer.from(hkdfSync("sha256", secret, Buffer.alloc(32), `fosscord-e2ee/v1/backup/${label}`, 32));
    let plaintext: Buffer | undefined;
    try {
        plaintext = decrypt(derived, box, Buffer.from(`${label}\n${userId}`, "utf8"));
        const jwk = JSON.parse(plaintext.toString("utf8")) as {
            kty?: string;
            crv?: string;
            x?: string;
            d?: string;
        };
        if (jwk.kty !== "OKP" || jwk.crv !== curve || typeof jwk.x !== "string" || typeof jwk.d !== "string") throw invalid();
        const seed = decode(jwk.d, 32);
        try {
            const prefix = Buffer.from(curve === "Ed25519" ? "302e020100300506032b657004220420" : "302e020100300506032b656e04220420", "hex");
            const key = createPrivateKey({
                key: Buffer.concat([prefix, seed]),
                format: "der",
                type: "pkcs8",
            });
            const publicKey = createPublicKey(key);
            const actual = decode(publicKey.export({ format: "jwk" }).x!, 32);
            if (!timingSafeEqual(actual, decode(jwk.x, 32)) || !timingSafeEqual(actual, decode(expectedPublic, 32))) throw invalid();
            return publicKey;
        } finally {
            seed.fill(0);
        }
    } finally {
        plaintext?.fill(0);
        derived.fill(0);
    }
};

export function validateBackupSecret(userId: string, backup: RecoveryBackup, secret: string): boolean {
    let bytes: Buffer | undefined;
    try {
        account(userId, backup.identity_key);
        bytes = decode(secret, 32);
        const identity = privateKeyFromBox(bytes, userId, "identity", backup.wrapped_identity, "Ed25519", backup.identity_key);
        privateKeyFromBox(bytes, userId, "backup-key", backup.wrapped_backup_key, "X25519", backup.backup_public_key);
        const signature = decode(backup.backup_key_signature, 64);
        return verify(null, Buffer.from(`fosscord-e2ee/v1/backup-key\n${userId}\n${backup.backup_public_key}`, "utf8"), identity, signature);
    } catch {
        return false;
    } finally {
        bytes?.fill(0);
    }
}

export function recoveryProof(userId: string, identityKey: string, version: number, deviceId: string, secret: string): string {
    account(userId, identityKey);
    if (!Number.isSafeInteger(version) || version < 1) throw invalid();
    decode(deviceId, 16);
    const bytes = decode(secret, 32);
    try {
        return `fosscord-e2ee/v1/server-recovery\n${userId}\n${identityKey}\n${version}\n${deviceId}\n${createHash("sha256").update(bytes).digest("base64url")}`;
    } finally {
        bytes.fill(0);
    }
}
