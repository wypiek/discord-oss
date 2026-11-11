export const maxJsonInputBytes = 128 * 1024 * 1024;

export class JsonInput {
    private static readonly maxActiveInputs = 1024;
    private static activeInputs = 0;
    private static retainedBytes = 0;
    value = "";
    private bytes = 0;
    private tail = 0;
    private closed = false;

    constructor(private readonly limit = maxJsonInputBytes) {
        if (JsonInput.activeInputs >= JsonInput.maxActiveInputs) throw Object.assign(new Error("JSON reader capacity exceeded"), { code: "JSON_QUEUE_FULL" });
        JsonInput.activeInputs++;
    }

    append(chunk: string): void {
        if (this.closed) throw new Error("JSON input is closed");
        if (!chunk.length) return;
        const first = chunk.charCodeAt(0);
        const paired = this.tail >= 0xd800 && this.tail <= 0xdbff && first >= 0xdc00 && first <= 0xdfff;
        const bytes = this.bytes + Buffer.byteLength(chunk) - (paired ? 2 : 0);
        const added = bytes - this.bytes;
        if (bytes > this.limit || added > maxJsonInputBytes - JsonInput.retainedBytes)
            throw Object.assign(new Error("JSON input byte capacity exceeded"), {
                code: "JSON_QUEUE_FULL",
            });
        JsonInput.retainedBytes += added;
        this.bytes = bytes;
        this.tail = chunk.charCodeAt(chunk.length - 1);
        this.value += chunk;
    }

    close(): void {
        if (this.closed) return;
        this.closed = true;
        JsonInput.activeInputs--;
        JsonInput.retainedBytes -= this.bytes;
        this.bytes = 0;
        this.tail = 0;
        this.value = "";
    }
}
