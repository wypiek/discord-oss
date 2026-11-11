export const attachmentCiphertextUrl = (value: string, channelId: string, filename: string, origin: string): string | null => {
    let url: URL;
    try {
        url = new URL(value, origin);
    } catch {
        return null;
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    const opened = new URL(origin);
    const localHost = /^(?:localhost|[\w.-]+\.localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])$/i.test(url.hostname);
    if (url.host !== opened.host && !localHost) return value;
    if (!/^\d+$/.test(channelId)) return null;
    const path = /^\/attachments\/(\d+)\/(\d+)\/([^/]+)$/.exec(url.pathname);
    if (!path || path[1] !== channelId) return null;
    try {
        const decoded = decodeURIComponent(path[3]);
        if (/[/\\\0]/.test(decoded) || decoded !== filename) return null;
    } catch {
        return null;
    }
    return `${opened.origin}${url.pathname}${url.search}${url.hash}`;
};
