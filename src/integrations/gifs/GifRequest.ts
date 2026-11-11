const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export async function requestGifJson<T>(url: string, provider: string): Promise<T> {
    let response: Response;
    try {
        response = await fetch(url, {
            signal: AbortSignal.timeout(8000),
            headers: { Accept: "application/json" },
        });
    } catch {
        throw new Error(`${provider} request failed`);
    }
    if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new Error(`${provider} request failed (${response.status})`);
    }
    if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) {
        await response.body?.cancel().catch(() => {});
        throw new Error(`Invalid ${provider} response`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error(`Invalid ${provider} response`);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_RESPONSE_BYTES) throw new Error();
            chunks.push(value);
        }
        return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
    } catch {
        throw new Error(`Invalid ${provider} response`);
    } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}

export function gifText(value: unknown, maximum = 256): value is string {
    return typeof value === "string" && value.length <= maximum;
}

export function gifUrl(value: unknown): value is string {
    if (!gifText(value, 2048)) return false;
    try {
        const parsed = new URL(value);
        return ["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password;
    } catch {
        return false;
    }
}

export function gifDimension(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 16384;
}

export function gifLimit(value: number | undefined, maximum: number): number {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) ? Math.max(1, Math.min(parsed || maximum, maximum)) : maximum;
}
