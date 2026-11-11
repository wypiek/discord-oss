export const imageDimensions = (bytes: Uint8Array): { width: number; height: number } | null => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
    if (bytes.length >= 24 && bytes[0] === 0x89 && ascii(1, 4) === "PNG") return { width: view.getUint32(16), height: view.getUint32(20) };
    if (bytes.length >= 10 && ascii(0, 3) === "GIF") return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
    if (bytes.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
        const chunk = ascii(12, 16);
        if (chunk === "VP8 ") return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
        if (chunk === "VP8L") {
            const bits = view.getUint32(21, true);
            return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
        }
        if (chunk === "VP8X") return { width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)), height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) };
        return null;
    }
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    let offset = 2;
    while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) return null;
        const marker = bytes[offset + 1];
        const length = view.getUint16(offset + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) };
        offset += 2 + length;
    }
    return null;
};
