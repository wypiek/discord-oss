const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) => signature.every((value, index) => bytes[offset + index] === value);

const ascii = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));

export const sniffMediaType = (bytes: Uint8Array): string | null => {
    if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return ascii(bytes, 0, 128).includes("acTL") ? "image/apng" : "image/png";
    if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
    if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") return "image/gif";
    if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
    if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WAVE") return "audio/wav";
    if (ascii(bytes, 4, 8) === "ftyp") {
        const brand = ascii(bytes, 8, 12);
        if (brand === "avif" || brand === "avis") return "image/avif";
        if (brand.startsWith("M4A")) return "audio/mp4";
        if (brand === "qt  ") return "video/quicktime";
        return "video/mp4";
    }
    if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return "video/webm";
    if (ascii(bytes, 0, 4) === "OggS") return "audio/ogg";
    if (ascii(bytes, 0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return "audio/mpeg";
    if (ascii(bytes, 0, 4) === "fLaC") return "audio/flac";
    if (ascii(bytes, 0, 4) === "%PDF") return "application/pdf";
    if (startsWith(bytes, [0x00, 0x00, 0x01, 0x00])) return "image/x-icon";
    if (ascii(bytes, 0, 2) === "BM") return "image/bmp";
    const text = new TextDecoder().decode(bytes.subarray(0, 512)).trimStart();
    if (text.startsWith("<svg") || (text.startsWith("<?xml") && text.includes("<svg"))) return "image/svg+xml";
    if (text.startsWith("{") && text.includes('"layers"')) return "application/json";
    return null;
};

const INLINE_MEDIA_TYPE =
    /^(image\/(png|jpeg|gif|webp|avif|apng|bmp|x-icon|vnd\.microsoft\.icon)|video\/[\w.+-]+|audio\/[\w.+-]+|application\/json|application\/pdf|font\/[\w.+-]+|text\/plain)(;|$)/i;

export const safeMediaType = (mime: string | undefined | null) => (mime && INLINE_MEDIA_TYPE.test(mime) ? mime : "application/octet-stream");

const EXTENSION_TYPES: Record<string, string> = {
    txt: "text/plain; charset=utf-8",
    md: "text/plain; charset=utf-8",
    log: "text/plain; charset=utf-8",
    csv: "text/csv; charset=utf-8",
    css: "text/css; charset=utf-8",
    json: "application/json",
    lottie: "application/json",
    pdf: "application/pdf",
    mp3: "audio/mpeg",
    ogg: "audio/ogg",
    wav: "audio/wav",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    avif: "image/avif",
};

export const attachmentMediaType = (sniffed: string | null, filename: string) => {
    if (sniffed) return safeMediaType(sniffed);
    const extension = filename.split(".").pop()?.toLowerCase() ?? "";
    const guessed = EXTENSION_TYPES[extension];
    if (!guessed) return /^(js|mjs|xml|svg|html?|xhtml|mht|mhtml)$/.test(extension) ? "text/plain; charset=utf-8" : "application/octet-stream";
    return guessed;
};
