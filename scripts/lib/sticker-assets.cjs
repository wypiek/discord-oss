const crypto = require("node:crypto");

function validateStickerAsset(buffer, format) {
    if (format === 3) {
        const animation = JSON.parse(buffer.toString("utf8"));
        if (
            !animation ||
            !Array.isArray(animation.layers) ||
            !Number.isFinite(animation.w) ||
            !Number.isFinite(animation.h) ||
            animation.w < 1 ||
            animation.h < 1 ||
            !Number.isFinite(animation.fr) ||
            animation.fr <= 0
        )
            throw new Error("Invalid Lottie sticker");
        const strings = [];
        const visit = (value) => {
            if (typeof value === "string") strings.push(value);
            else if (value && typeof value === "object") for (const entry of Object.values(value)) visit(entry);
        };
        visit(animation);
        if (strings.some((value) => /https?:|^(?:\/\/|file:|ftp:)/i.test(value))) throw new Error("Lottie sticker contains external references");
        for (const asset of animation.assets || []) {
            if (asset.u || (asset.p && !/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/]+={0,2}$/i.test(asset.p)))
                throw new Error("Lottie sticker contains unresolved image references");
        }
        return { format: "lottie", externalReferences: 0 };
    }
    if ([1, 2].includes(format)) {
        if (
            buffer.length < 33 ||
            !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
            buffer.toString("ascii", 12, 16) !== "IHDR" ||
            buffer.readUInt32BE(16) < 1 ||
            buffer.readUInt32BE(20) < 1
        )
            throw new Error("Invalid PNG sticker");
        return { format: format === 2 ? "apng" : "png", externalReferences: 0 };
    }
    if (format === 4 && ["GIF87a", "GIF89a"].includes(buffer.toString("ascii", 0, 6))) return { format: "gif", externalReferences: 0 };
    throw new Error("Unsupported sticker format");
}
const digest = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
module.exports = { validateStickerAsset, digest };
