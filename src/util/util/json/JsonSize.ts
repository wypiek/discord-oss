export function measureJsonValue(value: unknown, limit: number): number {
    const pending = [value];
    const seen = new Set<object>();
    let bytes = 0;
    const add = (size: number) => {
        bytes += size;
        if (bytes > limit)
            throw Object.assign(new Error("JSON worker input byte capacity exceeded"), {
                code: "JSON_QUEUE_FULL",
            });
    };
    while (pending.length) {
        const current = pending.pop();
        if (typeof current === "string") add(Buffer.byteLength(current));
        else if (typeof current === "bigint") add(16 + Math.ceil(current.toString(16).length / 2));
        else if (current === null || typeof current !== "object") add(typeof current === "number" ? 8 : 1);
        else {
            if (seen.has(current)) continue;
            seen.add(current);
            add(32);
            if (current instanceof ArrayBuffer || current instanceof SharedArrayBuffer) {
                const buffer = current as ArrayBuffer & { maxByteLength?: number };
                add(buffer.maxByteLength ?? buffer.byteLength);
            } else if (ArrayBuffer.isView(current)) pending.push(current.buffer);
            else if (current instanceof Map) {
                add(current.size * 16);
                for (const [key, entry] of current) pending.push(key, entry);
            } else if (current instanceof Set) {
                add(current.size * 8);
                for (const entry of current) pending.push(entry);
            } else if (current instanceof Date) add(8);
            else if (current instanceof RegExp) add(Buffer.byteLength(current.source) + Buffer.byteLength(current.flags));
            else if (current instanceof Error) {
                add(Buffer.byteLength(current.name) + Buffer.byteLength(current.message) + Buffer.byteLength(current.stack ?? ""));
                const cause = Object.getOwnPropertyDescriptor(current, "cause");
                if (cause) {
                    add(8);
                    pending.push(cause.value);
                }
            } else if (typeof Blob !== "undefined" && current instanceof Blob) add(current.size + Buffer.byteLength(current.type));
            else {
                if (Array.isArray(current)) add(current.length * 8);
                for (const key of Object.keys(current)) {
                    add(Buffer.byteLength(key) + 8);
                    pending.push((current as Record<string, unknown>)[key]);
                }
            }
        }
    }
    return bytes;
}
