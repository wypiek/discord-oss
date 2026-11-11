const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export class Utf8Encoder {
    readonly encoding = "utf-8";

    encode(input = "") {
        const out: number[] = [];
        for (let i = 0; i < input.length; i++) {
            let code = input.charCodeAt(i);
            if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
                const next = input.charCodeAt(i + 1);
                if (next >= 0xdc00 && next <= 0xdfff) {
                    code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
                    i++;
                } else code = 0xfffd;
            } else if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
            if (code < 0x80) out.push(code);
            else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
            else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
            else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
        }
        return new Uint8Array(out);
    }
}

export class Utf8Decoder {
    readonly encoding = "utf-8";

    decode(input?: ArrayBuffer | ArrayBufferView) {
        const bytes = !input ? new Uint8Array(0) : input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
        let out = "";
        let i = 0;
        while (i < bytes.length) {
            const first = bytes[i];
            const need = first < 0x80 ? 0 : first >= 0xc2 && first <= 0xdf ? 1 : first >= 0xe0 && first <= 0xef ? 2 : first >= 0xf0 && first <= 0xf4 ? 3 : -1;
            if (need < 0) {
                out += "�";
                i++;
                continue;
            }
            let code = need ? first & (0x3f >> need) : first;
            const lower = first === 0xe0 ? 0xa0 : first === 0xf0 ? 0x90 : 0x80;
            const upper = first === 0xed ? 0x9f : first === 0xf4 ? 0x8f : 0xbf;
            let read = 1;
            for (; read <= need; read++) {
                const next = bytes[i + read];
                if (next === undefined || next < (read === 1 ? lower : 0x80) || next > (read === 1 ? upper : 0xbf)) break;
                code = (code << 6) | (next & 63);
            }
            if (read <= need) {
                out += "�";
                i += read;
                continue;
            }
            out += String.fromCodePoint(code);
            i += need + 1;
        }
        return out;
    }
}

export const encodeBase64 = (binary: string) => {
    let out = "";
    for (let i = 0; i < binary.length; i += 3) {
        const a = binary.charCodeAt(i);
        const b = binary.charCodeAt(i + 1);
        const c = binary.charCodeAt(i + 2);
        if (a > 255 || b > 255 || c > 255) throw new Error("btoa only takes Latin-1 text");
        const n = (a << 16) | ((b || 0) << 8) | (c || 0);
        out += BASE64[(n >> 18) & 63] + BASE64[(n >> 12) & 63] + (i + 1 < binary.length ? BASE64[(n >> 6) & 63] : "=") + (i + 2 < binary.length ? BASE64[n & 63] : "=");
    }
    return out;
};

export const decodeBase64 = (text: string) => {
    const clean = text.replace(/[\t\n\f\r ]/g, "").replace(/={1,2}$/, "");
    if (clean.length % 4 === 1 || /[^A-Za-z0-9+/]/.test(clean)) throw new Error("atob got invalid base64");
    let out = "";
    let bits = 0;
    let value = 0;
    for (const char of clean) {
        value = (value << 6) | BASE64.indexOf(char);
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out += String.fromCharCode((value >> bits) & 255);
        }
    }
    return out;
};

const shared = ((globalThis as { __meowcordE2ee?: Record<string, unknown> }).__meowcordE2ee ??= {});
Object.assign(shared, { TextEncoder: Utf8Encoder, TextDecoder: Utf8Decoder, atob: decodeBase64, btoa: encodeBase64 });
