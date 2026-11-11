export const MAX_ATTACHMENT_FILENAME = 255;

export function cleanAttachmentFilename(name: unknown, fallback = "file") {
    const cleaned = String(name ?? "")
        .replaceAll(" ", "_")
        .replace(/[^a-zA-Z0-9._-]+/g, "");
    if (!cleaned || cleaned === "." || cleaned === "..") return fallback;
    if (cleaned.length <= MAX_ATTACHMENT_FILENAME) return cleaned;
    const dot = cleaned.lastIndexOf(".");
    const extension = dot > 0 && cleaned.length - dot <= 16 ? cleaned.slice(dot) : "";
    return cleaned.slice(0, MAX_ATTACHMENT_FILENAME - extension.length) + extension;
}

export function declaredAttachmentFilename(name: unknown) {
    if (typeof name !== "string" || !name || name.length > MAX_ATTACHMENT_FILENAME || name === "." || name === "..") return undefined;
    return /[/\\?#%]/.test(name) || [...name].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ? undefined : name;
}
