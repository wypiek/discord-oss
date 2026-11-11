import { argon2idAsync } from "@noble/hashes/argon2.js";

interface Argon2Options {
    password: Uint8Array | string;
    salt: Uint8Array | string;
    parallelism: number;
    iterations: number;
    memorySize: number;
    hashLength: number;
    outputType?: "binary" | "hex";
}

export const argon2id = async ({ password, salt, parallelism, iterations, memorySize, hashLength }: Argon2Options) =>
    argon2idAsync(password, salt, { p: parallelism, t: iterations, m: memorySize, dkLen: hashLength, asyncTick: 25 });
