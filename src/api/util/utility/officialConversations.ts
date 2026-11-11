import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { createDecipheriv, createPrivateKey, createPublicKey, hkdfSync } from "node:crypto";
import { Aes256Gcm, CipherSuite, DhkemX25519HkdfSha256, HkdfSha256 } from "@hpke/core";
import { Channel, E2eeDevice, E2eeIdentity, Message, Recipient } from "@spacebar/database";
import { ChannelType } from "@spacebar/schemas";
import { decodeKey, e2eeDeviceId, e2eeDeviceMessage, e2eeLimits, e2eeRotationMessage, verifyEd25519 } from "./e2ee";
import { getSystemAccount } from "./systemAccounts";
import { ensureSystemSender } from "./systemEncryption";

const suite = new CipherSuite({
    kem: new DhkemX25519HkdfSha256(),
    kdf: new HkdfSha256(),
    aead: new Aes256Gcm(),
});
const unavailable = () => new Error("Official message could not be verified or decrypted");

export interface OfficialMessagePayload {
    content: string;
    attachments?: {
        name: string;
        filename: string;
        content_type: string;
        size: number;
        key: string;
        iv: string;
    }[];
}

async function officialPrekey(userId: string, expectedPublic: string) {
    const directory = process.env.E2EE_SYSTEM_KEY_DIR || path.join(path.dirname(path.resolve(process.env.CONFIG_PATH || "config.json")), ".e2ee-system");
    const file = await fs.open(path.join(directory, `${userId}.key`), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let seed: Buffer | null = null;
    let secret: Buffer | null = null;
    try {
        const stat = await file.stat();
        if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 128) throw unavailable();
        const value = (await file.readFile("utf8")).trim();
        seed = Buffer.from(value, "base64url");
        if (seed.length !== 32 || seed.toString("base64url") !== value) throw unavailable();
        secret = Buffer.from(hkdfSync("sha256", seed, Buffer.alloc(32), "fosscord-e2ee/v1/system-sender/prekey", 32));
        const key = createPrivateKey({
            key: Buffer.concat([Buffer.from("302e020100300506032b656e04220420", "hex"), secret]),
            format: "der",
            type: "pkcs8",
        });
        if (createPublicKey(key).export({ format: "jwk" }).x !== expectedPublic) throw unavailable();
        return await suite.kem.deserializePrivateKey(secret);
    } finally {
        seed?.fill(0);
        secret?.fill(0);
        await file.close();
    }
}

async function officialDecryptor(channelId: string) {
    const official = await getSystemAccount("official");
    const [channel, recipients] = await Promise.all([
        Channel.findOne({ where: { id: channelId }, select: { id: true, type: true, guild_id: true } }),
        Recipient.find({ where: { channel_id: channelId }, select: { user_id: true } }),
    ]);
    const members = Object.freeze(recipients.map((recipient) => recipient.user_id));
    if (channel?.id !== channelId || channel.type !== ChannelType.DM || channel.guild_id || members.length !== 2 || new Set(members).size !== 2 || !members.includes(official.id))
        throw unavailable();
    const devices = new Map<string, Promise<E2eeDevice | null>>();
    const identities = new Map<string, Promise<E2eeIdentity | null>>();
    let managedKey:
        | Promise<{
              managed: Awaited<ReturnType<typeof ensureSystemSender>>;
              recipientKey: Awaited<ReturnType<typeof officialPrekey>>;
          }>
        | undefined;
    return async (message: Message): Promise<OfficialMessagePayload> => {
        if (!/^\d{1,20}$/.test(message.id) || message.channel_id !== channelId || !message.author_id || !members.includes(message.author_id) || !message.encrypted)
            throw unavailable();
        const env = message.encrypted;
        if (env.v !== 1 || env.alg !== "x25519-hpke-aes256gcm-ed25519" || !Array.isArray(env.keys) || Buffer.byteLength(JSON.stringify(env)) > e2eeLimits().maxEnvelopeBytes)
            throw unavailable();
        if (env.mid ? env.mid !== message.id : !message.nonce) throw unavailable();
        const deviceKey = `${message.author_id}:${env.sender_device}`;
        if (!devices.has(deviceKey))
            devices.set(
                deviceKey,
                E2eeDevice.findOne({ where: { id: env.sender_device, user_id: message.author_id } }).then((device) =>
                    device
                        ? (Object.freeze({
                              ...device,
                              revoked_at: device.revoked_at ? new Date(device.revoked_at) : null,
                          }) as E2eeDevice)
                        : null,
                ),
            );
        if (!identities.has(message.author_id))
            identities.set(
                message.author_id,
                E2eeIdentity.findOne({ where: { user_id: message.author_id } }).then((identity) => (identity ? (Object.freeze({ ...identity }) as E2eeIdentity) : null)),
            );
        const [device, identity] = await Promise.all([devices.get(deviceKey)!, identities.get(message.author_id)!]);
        if (!device || !identity || e2eeDeviceId(device.signing_key) !== device.id || !device.identity_signature) throw unavailable();
        if (device.status !== "active" && !(device.status === "revoked" && device.revoked_at && message.timestamp < device.revoked_at)) throw unavailable();
        const identityMessage = e2eeDeviceMessage(message.author_id, device.id, device.signing_key);
        const verified =
            verifyEd25519(identity.public_key, identityMessage, device.identity_signature) ||
            (!!identity.previous_key &&
                !!identity.rotation_signature &&
                verifyEd25519(identity.previous_key, e2eeRotationMessage(message.author_id, identity.previous_key, identity.public_key), identity.rotation_signature) &&
                verifyEd25519(identity.previous_key, identityMessage, device.identity_signature));
        if (!verified) throw unavailable();
        const bind = env.mid ? `m:${env.mid}` : `n:${message.nonce}`;
        const signed: unknown[] = [
            "fosscord-e2ee/v1/sig",
            message.channel_id,
            message.author_id,
            bind,
            env.v,
            env.alg,
            env.sender_device,
            env.mid ?? null,
            env.iv,
            env.ct,
            [...env.keys].sort((a, b) => (a.device_id < b.device_id ? -1 : 1)).map((entry) => [entry.user_id, entry.device_id, entry.prekey_id, entry.enc, entry.wrapped]),
        ];
        if (env.backup) signed.push([...env.backup].sort((a, b) => (a.user_id < b.user_id ? -1 : 1)).map((entry) => [entry.user_id, entry.enc, entry.wrapped]));
        if (!verifyEd25519(device.signing_key, JSON.stringify(signed), env.sig)) throw unavailable();
        managedKey ??= (async () => {
            const managed = await ensureSystemSender(official);
            return { managed, recipientKey: await officialPrekey(official.id, managed.prekeyPublic) };
        })();
        const { managed, recipientKey } = await managedKey;
        const target = env.keys.find((entry) => entry.user_id === official.id && entry.device_id === managed.deviceId && entry.prekey_id === 1);
        if (!target || !decodeKey(env.iv, 12) || !decodeKey(target.enc, 32)) throw unavailable();
        const aad = `fosscord-e2ee/v1/msg\n${message.channel_id}\n${message.author_id}\n${env.sender_device}\n${bind}`;
        const key = Buffer.from(
            await suite.open(
                {
                    recipientKey,
                    enc: Buffer.from(target.enc, "base64url"),
                    info: Buffer.from("fosscord-e2ee/v1/wrap"),
                },
                Buffer.from(target.wrapped, "base64url"),
                Buffer.from(`${aad}\n${target.device_id}`),
            ),
        );
        try {
            if (key.length !== 32) throw unavailable();
            const ciphertext = Buffer.from(env.ct, "base64url");
            if (ciphertext.length < 16) throw unavailable();
            const cipher = createDecipheriv("aes-256-gcm", key, Buffer.from(env.iv, "base64url"));
            cipher.setAAD(Buffer.from(aad));
            cipher.setAuthTag(ciphertext.subarray(-16));
            const payload = JSON.parse(Buffer.concat([cipher.update(ciphertext.subarray(0, -16)), cipher.final()]).toString("utf8")) as OfficialMessagePayload;
            if (!payload || typeof payload.content !== "string" || (payload.attachments !== undefined && !Array.isArray(payload.attachments))) throw unavailable();
            return payload;
        } finally {
            key.fill(0);
        }
    };
}

export async function decryptOfficialMessages(messages: Message[]): Promise<PromiseSettledResult<OfficialMessagePayload>[]> {
    if (messages.length > 20) throw unavailable();
    if (!messages.length) return [];
    const context = officialDecryptor(messages[0].channel_id!);
    const results: PromiseSettledResult<OfficialMessagePayload>[] = new Array(messages.length);
    let next = 0;
    await Promise.all(
        Array.from({ length: Math.min(4, messages.length) }, async () => {
            while (next < messages.length) {
                const index = next++;
                try {
                    results[index] = { status: "fulfilled", value: await (await context)(messages[index]) };
                } catch (reason) {
                    results[index] = { status: "rejected", reason };
                }
            }
        }),
    );
    return results;
}

export async function decryptOfficialMessage(messageId: string): Promise<OfficialMessagePayload> {
    if (!/^\d{1,20}$/.test(messageId)) throw unavailable();
    const message = await Message.findOne({ where: { id: messageId } });
    if (!message) throw unavailable();
    const [result] = await decryptOfficialMessages([message]);
    if (result.status === "rejected") throw result.reason;
    return result.value;
}
