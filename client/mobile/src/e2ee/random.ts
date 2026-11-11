import { fromBase64Url, type RandomSource } from "./subtle";

type NativeLookup = (name: string) => Record<string, unknown> | null;

const fromBase64 = (text: string) => fromBase64Url(text.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));

const looksRandom = (sample: Uint8Array, again: Uint8Array) => sample.some((byte) => byte !== 0) && sample.some((byte, i) => byte !== again[i]) && new Set(sample).size > 8;

const CANDIDATES: { module: string; describe: string; make: (mod: Record<string, unknown>) => RandomSource | null }[] = [
    {
        module: "RNGetRandomValues",
        describe: "RNGetRandomValues.getRandomBase64, backed by java.security.SecureRandom",
        make: (mod) => (typeof mod.getRandomBase64 === "function" ? (length) => fromBase64(String((mod.getRandomBase64 as (n: number) => unknown)(length))) : null),
    },
    {
        module: "ExpoCrypto",
        describe: "ExpoCrypto.getRandomBase64String, backed by java.security.SecureRandom",
        make: (mod) => (typeof mod.getRandomBase64String === "function" ? (length) => fromBase64(String((mod.getRandomBase64String as (n: number) => unknown)(length))) : null),
    },
];

export const findRandomSource = (lookup: NativeLookup): { source: RandomSource; describe: string } | null => {
    for (const candidate of CANDIDATES) {
        let mod: Record<string, unknown> | null = null;
        try {
            mod = lookup(candidate.module);
        } catch {
            mod = null;
        }
        if (!mod) continue;
        const make = candidate.make(mod);
        if (!make) continue;
        const source: RandomSource = (length) => {
            if (!Number.isInteger(length) || length < 0 || length > 65536) throw new Error("invalid random length");
            if (!length) return new Uint8Array(0);
            const bytes = make(length);
            if (bytes.length !== length) throw new Error(`${candidate.module} returned ${bytes.length} bytes instead of ${length}`);
            return bytes;
        };
        try {
            if (!looksRandom(source(32), source(32))) continue;
        } catch {
            continue;
        }
        return { source, describe: candidate.describe };
    }
    return null;
};
