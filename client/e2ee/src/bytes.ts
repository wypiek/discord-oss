export type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const utf8 = (text: string): Bytes => encoder.encode(text);

export const fromUtf8 = (bytes: ArrayBuffer | Uint8Array) => decoder.decode(bytes);

export const toB64u = (input: ArrayBuffer | Uint8Array) => {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const fromB64u = (text: string): Bytes => {
    if (typeof text !== "string" || !/^[A-Za-z0-9_-]*$/.test(text)) throw new Error("invalid base64url");
    const binary = atob(
        text
            .replace(/-/g, "+")
            .replace(/_/g, "/")
            .padEnd(Math.ceil(text.length / 4) * 4, "="),
    );
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
};

export const randomBytes = (length: number): Bytes => crypto.getRandomValues(new Uint8Array(length));

export const sha256 = async (data: Bytes): Promise<Bytes> => new Uint8Array(await crypto.subtle.digest("SHA-256", data));
