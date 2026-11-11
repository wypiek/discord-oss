const VERSION = 131;
const NEW_FLOAT = 70;
const SMALL_INTEGER = 97;
const INTEGER = 98;
const FLOAT_STRING = 99;
const ATOM = 100;
const SMALL_TUPLE = 104;
const LARGE_TUPLE = 105;
const NIL = 106;
const STRING = 107;
const LIST = 108;
const BINARY = 109;
const SMALL_BIG = 110;
const LARGE_BIG = 111;
const SMALL_ATOM = 115;
const MAP = 116;
const ATOM_UTF8 = 118;
const SMALL_ATOM_UTF8 = 119;
const MAX_DEPTH = 256;
const MAX_BIG_DIGITS = 32;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });
const latin1Decoder = new TextDecoder("latin1");

class Writer {
    buffer = new Uint8Array(256);
    view = new DataView(this.buffer.buffer);
    length = 0;

    reserve(bytes: number) {
        if (this.length + bytes <= this.buffer.length) return;
        let size = this.buffer.length * 2;
        while (size < this.length + bytes) size *= 2;
        const next = new Uint8Array(size);
        next.set(this.buffer.subarray(0, this.length));
        this.buffer = next;
        this.view = new DataView(next.buffer);
    }

    byte(value: number) {
        this.reserve(1);
        this.buffer[this.length++] = value;
    }

    uint16(value: number) {
        this.reserve(2);
        this.view.setUint16(this.length, value);
        this.length += 2;
    }

    int32(value: number) {
        this.reserve(4);
        this.view.setInt32(this.length, value);
        this.length += 4;
    }

    uint32(value: number) {
        this.reserve(4);
        this.view.setUint32(this.length, value);
        this.length += 4;
    }

    float64(value: number) {
        this.reserve(8);
        this.view.setFloat64(this.length, value);
        this.length += 8;
    }

    bytes(value: Uint8Array) {
        this.reserve(value.length);
        this.buffer.set(value, this.length);
        this.length += value.length;
    }
}

function writeAtom(writer: Writer, name: string) {
    const bytes = textEncoder.encode(name);
    writer.byte(SMALL_ATOM);
    writer.byte(bytes.length);
    writer.bytes(bytes);
}

function writeBig(writer: Writer, value: bigint) {
    const negative = value < 0n;
    let magnitude = negative ? -value : value;
    const digits: number[] = [];
    while (magnitude > 0n) {
        digits.push(Number(magnitude & 0xffn));
        magnitude >>= 8n;
    }
    if (digits.length < 256) {
        writer.byte(SMALL_BIG);
        writer.byte(digits.length);
    } else {
        writer.byte(LARGE_BIG);
        writer.uint32(digits.length);
    }
    writer.byte(negative ? 1 : 0);
    writer.bytes(Uint8Array.from(digits));
}

function writeNumber(writer: Writer, value: number) {
    if (!Number.isFinite(value)) return writeAtom(writer, "nil");
    if (!Number.isInteger(value)) {
        writer.byte(NEW_FLOAT);
        return writer.float64(value);
    }
    if (value >= 0 && value <= 255) {
        writer.byte(SMALL_INTEGER);
        return writer.byte(value);
    }
    if (value >= -(2 ** 31) && value < 2 ** 31) {
        writer.byte(INTEGER);
        return writer.int32(value);
    }
    if (Number.isSafeInteger(value)) return writeBig(writer, BigInt(value));
    writer.byte(NEW_FLOAT);
    writer.float64(value);
}

function writeTerm(writer: Writer, value: unknown, depth: number) {
    if (depth > MAX_DEPTH) throw new Error("ETF term nests too deeply");
    if (value === null || value === undefined) return writeAtom(writer, "nil");
    switch (typeof value) {
        case "boolean":
            return writeAtom(writer, value ? "true" : "false");
        case "number":
            return writeNumber(writer, value);
        case "bigint":
            return writeBig(writer, value);
        case "string": {
            const bytes = textEncoder.encode(value);
            writer.byte(BINARY);
            writer.uint32(bytes.length);
            return writer.bytes(bytes);
        }
        case "object": {
            if (Array.isArray(value)) {
                if (!value.length) return writer.byte(NIL);
                writer.byte(LIST);
                writer.uint32(value.length);
                for (const item of value) writeTerm(writer, item, depth + 1);
                return writer.byte(NIL);
            }
            const entries = Object.entries(value).filter(([, item]) => item !== undefined && typeof item !== "function" && typeof item !== "symbol");
            writer.byte(MAP);
            writer.uint32(entries.length);
            for (const [key, item] of entries) {
                writeTerm(writer, key, depth + 1);
                writeTerm(writer, item, depth + 1);
            }
            return;
        }
        default:
            throw new Error(`ETF can't encode a ${typeof value}`);
    }
}

export function packEtf(value: unknown): Buffer {
    const writer = new Writer();
    writer.byte(VERSION);
    writeTerm(writer, value, 0);
    return Buffer.from(writer.buffer.buffer, 0, writer.length);
}

function atomValue(name: string) {
    if (name === "nil" || name === "null") return null;
    if (name === "true") return true;
    if (name === "false") return false;
    return name;
}

export function unpackEtf(input: Uint8Array): unknown {
    const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
    let offset = 0;

    const take = (bytes: number) => {
        if (bytes < 0 || offset + bytes > input.byteLength) throw new RangeError("ETF term is truncated");
        const start = offset;
        offset += bytes;
        return start;
    };
    const slice = (bytes: number) => {
        const start = take(bytes);
        return input.subarray(start, start + bytes);
    };
    const readBig = (digits: number) => {
        if (digits > MAX_BIG_DIGITS) throw new RangeError("ETF integer is too large");
        const negative = view.getUint8(take(1)) !== 0;
        const bytes = slice(digits);
        let result = 0n;
        for (let i = bytes.length - 1; i >= 0; i--) result = (result << 8n) | BigInt(bytes[i]);
        if (negative) result = -result;
        return Number.isSafeInteger(Number(result)) && BigInt(Number(result)) === result ? Number(result) : result;
    };

    const readTerm = (depth: number): unknown => {
        if (depth > MAX_DEPTH) throw new Error("ETF term nests too deeply");
        const tag = view.getUint8(take(1));
        switch (tag) {
            case SMALL_INTEGER:
                return view.getUint8(take(1));
            case INTEGER:
                return view.getInt32(take(4));
            case NEW_FLOAT:
                return view.getFloat64(take(8));
            case FLOAT_STRING:
                return Number.parseFloat(latin1Decoder.decode(slice(31)).replace(/\0+$/, ""));
            case ATOM:
                return atomValue(latin1Decoder.decode(slice(view.getUint16(take(2)))));
            case SMALL_ATOM:
                return atomValue(latin1Decoder.decode(slice(view.getUint8(take(1)))));
            case ATOM_UTF8:
                return atomValue(textDecoder.decode(slice(view.getUint16(take(2)))));
            case SMALL_ATOM_UTF8:
                return atomValue(textDecoder.decode(slice(view.getUint8(take(1)))));
            case BINARY:
                return textDecoder.decode(slice(view.getUint32(take(4))));
            case STRING:
                return latin1Decoder.decode(slice(view.getUint16(take(2))));
            case NIL:
                return [];
            case SMALL_TUPLE:
            case LARGE_TUPLE:
            case LIST: {
                const length = tag === SMALL_TUPLE ? view.getUint8(take(1)) : view.getUint32(take(4));
                if (length > input.byteLength - offset) throw new RangeError("ETF list is longer than the frame");
                const items: unknown[] = [];
                for (let i = 0; i < length; i++) items.push(readTerm(depth + 1));
                if (tag === LIST && view.getUint8(take(1)) !== NIL) throw new Error("ETF improper lists are not supported");
                return items;
            }
            case MAP: {
                const length = view.getUint32(take(4));
                if (length * 2 > input.byteLength - offset) throw new RangeError("ETF map is longer than the frame");
                const result: Record<string, unknown> = {};
                for (let i = 0; i < length; i++) {
                    const key = readTerm(depth + 1);
                    if (key === "__proto__") throw new Error("ETF map key is not allowed");
                    result[String(key)] = readTerm(depth + 1);
                }
                return result;
            }
            case SMALL_BIG:
                return readBig(view.getUint8(take(1)));
            case LARGE_BIG:
                return readBig(view.getUint32(take(4)));
            default:
                throw new Error(`Unsupported ETF tag ${tag}`);
        }
    };

    if (view.getUint8(take(1)) !== VERSION) throw new Error("ETF version byte is missing");
    const result = readTerm(0);
    if (offset !== input.byteLength) throw new Error("ETF frame has trailing bytes");
    return result;
}
