import { argon2id } from "./argon2";
import { createWebCrypto, fromBase64Url, toBase64Url } from "./subtle";

const SEED = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const PEER = Uint8Array.from({ length: 32 }, (_, i) => 200 - i);

const EXPECTED = {
    edPublic: "ebVWLo_mVPlAeLES6KmLp5AfhTrmlb7X4OORC60ElmQ",
    edSignature: "a0a5a7fa956f9660aa0f106a2638aeadc89627d5b396b2b0326be9e868db91c01a7fe9f517f58c315315312b53eff793615cb5a778f3c7ef84b2fe4109e03c03",
    xPublic: "B6N8vBQgk8i3VdwbEOhstCY3StFqqFPtC9_AsrhtHHw",
    peerPublic: "ja_P7q6QRe6aeNeKmfzzLneB5EHrBzCWw0K44tzDthI",
    shared: "c59a3caae04422419f688043a6520cc5037ebcdb95e4bdada713b0cd291a2773",
    aes: "c54fd8a9ca421771f1447137799354f557d284",
    hkdf: "3d1533d36575bfdc461b60445313b8ef821ce567d5dd2dd4f9c6b7329217699c",
    sha512: "77788f1a0cea001a2631dae5d05dbd062008d5b30f50b9e29beb2a7822289004573dfc9b6ffeb1c786a16349e70f9836876a743c31c0a7a2a70727a852eec372",
    argonSmall: "fb0f61950138a8079535fffc5501ecdf1e18726d6b52aa18e6bcf1ff2e5012e1",
    argonFull: "5a2000af5b47f757c4817d02b021d557461fc2a2cbec15f5c98c658c4dd553d7",
};

const hex = (value: ArrayBuffer | Uint8Array) => [...(value instanceof Uint8Array ? value : new Uint8Array(value))].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const text = (value: string) => Uint8Array.from(value, (char) => char.charCodeAt(0));

export const knownAnswers = async (log: (message: string) => void, full: boolean) => {
    const { subtle } = createWebCrypto(() => {
        throw new Error("the known answer tests use no randomness");
    });
    const results: Record<string, string> = {};
    const check = async (name: keyof typeof EXPECTED, run: () => Promise<string>) => {
        const started = Date.now();
        try {
            const value = await run();
            results[name] = value === EXPECTED[name] ? `ok ${Date.now() - started}ms` : `mismatch ${value}`;
        } catch (error) {
            results[name] = `failed ${error instanceof Error ? error.message : String(error)}`;
        }
    };
    const okp = (name: "Ed25519" | "X25519", d: Uint8Array, x: string, usages: string[]) =>
        subtle.importKey("jwk", { kty: "OKP", crv: name, d: toBase64Url(d), x }, { name }, false, usages) as Promise<CryptoKey>;
    await check("edSignature", async () => hex(await subtle.sign({ name: "Ed25519" }, (await okp("Ed25519", SEED, EXPECTED.edPublic, ["sign"])) as never, text("kat"))));
    await check("shared", async () => {
        const peer = await subtle.importKey("raw", fromBase64Url(EXPECTED.peerPublic), { name: "X25519" }, true, []);
        return hex(await subtle.deriveBits({ name: "X25519", public: peer }, (await okp("X25519", SEED, EXPECTED.xPublic, ["deriveBits"])) as never, 256));
    });
    await check("peerPublic", async () => {
        await okp("X25519", PEER, EXPECTED.peerPublic, ["deriveBits"]);
        return EXPECTED.peerPublic;
    });
    await check("aes", async () =>
        hex(
            await subtle.encrypt(
                { name: "AES-GCM", iv: SEED.slice(0, 12), additionalData: text("aad") },
                (await subtle.importKey("raw", SEED, { name: "AES-GCM" }, false, ["encrypt"])) as never,
                text("kat"),
            ),
        ),
    );
    await check("hkdf", async () =>
        hex(
            await subtle.deriveBits(
                { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: text("kat") },
                (await subtle.importKey("raw", SEED, "HKDF", false, ["deriveBits"])) as never,
                256,
            ),
        ),
    );
    await check("sha512", async () => hex(await subtle.digest("SHA-512", SEED)));
    const argon = (iterations: number, memorySize: number) => argon2id({ password: text("pw"), salt: SEED.slice(0, 16), parallelism: 1, iterations, memorySize, hashLength: 32 });
    await check("argonSmall", async () => hex(await argon(1, 1024)));
    if (full) await check("argonFull", async () => hex(await argon(3, 65536)));
    log(`known answer tests ${JSON.stringify(results)}`);
};
