const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");
const { once } = require("node:events");
const { spawnSync } = require("node:child_process");
const turn = () => new Promise((resolve) => setImmediate(resolve));
const moduleForFixture = { exports: {} };
vm.runInNewContext(fs.readFileSync("dist/util/util/json/JsonSerializer.js", "utf8"), {
    module: moduleForFixture,
    exports: moduleForFixture.exports,
    JSON,
    TextDecoder,
    TextEncoder,
    ReadableStream,
    WritableStream,
    require: (name) => {
        if (name === "./JsonWorkerPool")
            return {
                JsonWorkerPool: class {
                    request(type, value) {
                        return Promise.resolve().then(() => (type === "serialize" ? JSON.stringify(value) : JSON.parse(value)));
                    }
                },
            };
        if (name === "./JsonArray") return require("../../dist/util/util/json/JsonArray.js");
        if (name === "./JsonInput") return require("../../dist/util/util/json/JsonInput.js");
        return require(name);
    },
});
const serializer = moduleForFixture.exports.JsonSerializer;
const encode = (value) => new TextEncoder().encode(value);
const bytesStream = (value, size = 1) =>
    new ReadableStream({
        start(controller) {
            const bytes = encode(value);
            for (let offset = 0; offset < bytes.length; offset += size) controller.enqueue(bytes.slice(offset, offset + size));
            controller.close();
        },
    });
const collect = async (values) => {
    const result = [];
    for await (const value of values) result.push(value);
    return result;
};
async function* items(values) {
    yield* values;
}
const fixture = () => fs.mkdtempSync("/tmp/meowcord-json-stream-test-");

const unicode = { text: "🏳️‍⚧️ café 日本語", nested: { text: 'escaped \\" [,] {x}' } };

test("web JSON decoding preserves one-byte UTF-8 chunks and releases its reader", async () => {
    const stream = bytesStream(JSON.stringify(unicode));
    assert.deepEqual(await serializer.DeserializeAsync(stream), unicode);
    assert.equal(stream.locked, false);
});

test("native file JSON decoding preserves one-byte chunks and already-decoded text", async () => {
    const dir = fixture();
    try {
        const file = path.join(dir, "data.json");
        fs.writeFileSync(file, JSON.stringify(unicode));
        for (const encoding of [undefined, "utf8"]) {
            const stream = fs.createReadStream(file, { highWaterMark: 1, encoding });
            assert.deepEqual(await serializer.DeserializeAsync(stream), unicode);
            if (!stream.closed) await once(stream, "close");
            assert.equal(stream.closed, true);
        }
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("array enumeration yields mixed nested values from byte chunks and unlocks readers", async () => {
    const values = [unicode, 'a,b]\\"', true, false, null, -2, 1.2e10, [], [{ x: [1, 2] }]];
    const stream = bytesStream(JSON.stringify(values));
    assert.deepEqual(await collect(serializer.DeserializeAsyncEnumerable(stream)), values);
    assert.equal(stream.locked, false);
    assert.deepEqual(await collect(serializer.DeserializeAsyncEnumerable(JSON.stringify(values))), values);
});

test("native file array enumeration preserves nested Unicode values across one-byte reads", async () => {
    const dir = fixture();
    try {
        const file = path.join(dir, "array.json");
        const values = [unicode, null, [], 23];
        fs.writeFileSync(file, JSON.stringify(values));
        const stream = fs.createReadStream(file, { highWaterMark: 1 });
        assert.deepEqual(await collect(serializer.DeserializeAsyncEnumerable(stream)), values);
        if (!stream.closed) await once(stream, "close");
        assert.equal(stream.closed, true);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("incremental enumeration yields before EOF and early return cancels and releases the source", async () => {
    let pulls = 0;
    let cancellations = 0;
    const stream = new ReadableStream(
        {
            pull(controller) {
                pulls++;
                if (pulls === 1) controller.enqueue(encode("[1,"));
                else return new Promise(() => {});
            },
            cancel() {
                cancellations++;
            },
        },
        { highWaterMark: 0 },
    );
    const iterator = serializer.DeserializeAsyncEnumerable(stream);
    const first = await iterator.next();
    assert.equal(first.value, 1);
    assert.equal(first.done, false);
    assert.equal(pulls, 1);
    assert.equal(cancellations, 0);
    await iterator.return();
    assert.equal(cancellations, 1);
    assert.equal(stream.locked, false);
});

test("early file enumeration return closes the owned read stream", async () => {
    const dir = fixture();
    try {
        const file = path.join(dir, "array.json");
        fs.writeFileSync(file, "[1,2,3]");
        const stream = fs.createReadStream(file, { highWaterMark: 1 });
        const iterator = serializer.DeserializeAsyncEnumerable(stream);
        assert.equal((await iterator.next()).value, 1);
        await iterator.return();
        if (!stream.closed) await once(stream, "close");
        assert.equal(stream.destroyed, true);
        assert.equal(stream.closed, true);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

for (const json of ["", "null", "{}", '"array"', "[", "[1", "[,1]", "[1,]", "[1,,2]", "[true false]", "[{]", "[1]t", "[1]\u00a0", "[\u00a0]", "[1] []"])
    test(`array enumeration rejects malformed input ${JSON.stringify(json)} and releases its reader`, async () => {
        const stream = bytesStream(json);
        await assert.rejects(collect(serializer.DeserializeAsyncEnumerable(stream)));
        assert.equal(stream.locked, false);
    });

test("JSON array whitespace accepts only JSON whitespace and empty arrays", async () => {
    assert.deepEqual(await collect(serializer.DeserializeAsyncEnumerable(bytesStream(" \t\r\n[ \t\r\n]\n"))), []);
    await assert.rejects(collect(serializer.DeserializeAsyncEnumerable('"text"')), /Expected a JSON array/);
});

test("invalid UTF-8 cancels a web source and releases its reader", async () => {
    let cancelled = false;
    const stream = new ReadableStream({
        start(controller) {
            controller.enqueue(Uint8Array.of(0xff));
        },
        cancel() {
            cancelled = true;
        },
    });
    await assert.rejects(serializer.DeserializeAsync(stream));
    assert.equal(cancelled, true);
    assert.equal(stream.locked, false);
});

test("upstream read errors reach the caller and release the acquired web reader", async () => {
    const failure = new Error("owned upstream read failed");
    const stream = new ReadableStream({
        pull(controller) {
            controller.error(failure);
        },
    });
    await assert.rejects(serializer.DeserializeAsync(stream), (error) => error === failure);
    assert.equal(stream.locked, false);
});

test("enumerable string output preserves Unicode and JSON array null placeholders", async () => {
    const values = [unicode, undefined, () => {}, Symbol("owned"), null, [1, 2]];
    assert.equal(await serializer.SerializeAsyncEnumerableToStringAsync(items(values)), JSON.stringify(values));
    assert.equal(await serializer.SerializeAsyncEnumerableToStringAsync(items([])), "[]");
});

test("web output respects blocked writes before pulling items and releases its writer", async () => {
    let release;
    const held = new Promise((resolve) => (release = resolve));
    let pulls = 0;
    let closed = false;
    const chunks = [];
    const stream = new WritableStream({
        async write(chunk) {
            chunks.push(Buffer.from(chunk));
            if (chunks.length === 1) await held;
        },
        close() {
            closed = true;
        },
    });
    const input = (async function* () {
        pulls++;
        yield unicode;
        pulls++;
        yield null;
    })();
    const writing = serializer.SerializeAsyncEnumerableAsync(input, stream);
    await turn();
    assert.equal(stream.locked, true);
    assert.equal(pulls, 0);
    release();
    await writing;
    assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), [unicode, null]);
    assert.equal(closed, true);
    assert.equal(stream.locked, false);
});

test("web output source failures abort the sink, release the writer and preserve the original error", async () => {
    const failure = new Error("owned item source failed");
    let disposed = false;
    let aborted;
    const input = (async function* () {
        try {
            yield 1;
            throw failure;
        } finally {
            disposed = true;
        }
    })();
    const stream = new WritableStream({
        write() {},
        abort(error) {
            aborted = error;
            throw new Error("owned abort failed");
        },
    });
    await assert.rejects(serializer.SerializeAsyncEnumerableAsync(input, stream), (error) => error === failure);
    assert.equal(aborted, failure);
    assert.equal(disposed, true);
    assert.equal(stream.locked, false);
});

test("web write and close errors propagate, dispose active sources and release writers", async () => {
    for (const mode of ["write", "close"]) {
        const failure = new Error(`owned ${mode} failed`);
        let disposed = false;
        let writes = 0;
        const input = (async function* () {
            try {
                yield 1;
                yield 2;
            } finally {
                disposed = true;
            }
        })();
        const stream = new WritableStream({
            write() {
                if (mode === "write" && ++writes === 2) throw failure;
            },
            close() {
                if (mode === "close") throw failure;
            },
        });
        await assert.rejects(serializer.SerializeAsyncEnumerableAsync(input, stream), (error) => error === failure);
        assert.equal(disposed, true);
        assert.equal(stream.locked, false);
    }
});

test("serialization failure aborts web output without consuming later items", async () => {
    let pulls = 0;
    let disposed = false;
    const input = (async function* () {
        try {
            pulls++;
            yield 1n;
            pulls++;
            yield 2;
        } finally {
            disposed = true;
        }
    })();
    const stream = new WritableStream({ write() {} });
    await assert.rejects(serializer.SerializeAsyncEnumerableAsync(input, stream), /BigInt/);
    assert.equal(pulls, 1);
    assert.equal(disposed, true);
    assert.equal(stream.locked, false);
});

test("native file output waits for completion and preserves Unicode with a one-byte buffer", async () => {
    const dir = fixture();
    try {
        const file = path.join(dir, "output.json");
        const values = [unicode, undefined, null, [1, 2]];
        const stream = fs.createWriteStream(file, { highWaterMark: 1 });
        await serializer.SerializeAsyncEnumerableAsync(items(values), stream);
        assert.deepEqual(JSON.parse(await fsp.readFile(file, "utf8")), JSON.parse(JSON.stringify(values)));
        assert.equal(stream.closed, true);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("native file output errors reject and destroy the stream", async () => {
    const dir = fixture();
    try {
        const stream = fs.createWriteStream(path.join(dir, "missing", "output.json"));
        await assert.rejects(serializer.SerializeAsyncEnumerableAsync(items([unicode]), stream), /ENOENT/);
        assert.equal(stream.destroyed, true);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("native output source failure disposes the iterator and closes the partial file", async () => {
    const dir = fixture();
    try {
        const failure = new Error("owned file input failed");
        let disposed = false;
        const input = (async function* () {
            try {
                yield unicode;
                throw failure;
            } finally {
                disposed = true;
            }
        })();
        const stream = fs.createWriteStream(path.join(dir, "partial.json"), { highWaterMark: 1 });
        await assert.rejects(serializer.SerializeAsyncEnumerableAsync(input, stream), (error) => error === failure);
        assert.equal(disposed, true);
        assert.equal(stream.closed, true);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("native FIFO output applies backpressure until the reader opens", { timeout: 5000 }, async () => {
    const dir = fixture();
    let output;
    let reader;
    try {
        const file = path.join(dir, "owned.fifo");
        assert.equal(spawnSync("mkfifo", [file]).status, 0);
        let pulls = 0;
        const input = (async function* () {
            for (let id = 0; id < 100; id++) {
                pulls++;
                yield { id };
            }
        })();
        output = fs.createWriteStream(file, { highWaterMark: 1 });
        const writing = serializer.SerializeAsyncEnumerableAsync(input, output);
        await turn();
        await turn();
        assert.ok(pulls < 100);
        reader = fs.createReadStream(file);
        const chunks = [];
        for await (const chunk of reader) chunks.push(chunk);
        await writing;
        assert.deepEqual(
            JSON.parse(Buffer.concat(chunks).toString()),
            Array.from({ length: 100 }, (_, id) => ({ id })),
        );
        assert.equal(output.closed, true);
    } finally {
        output?.destroy();
        reader?.destroy();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("native JSON workers preserve Unicode through file and web streaming operations", { timeout: 6000 }, () => {
    const serializerPath = path.resolve("dist/util/util/json/JsonSerializer.js");
    const lifecyclePath = path.resolve("dist/util/util/ProcessLifecycle.js");
    const source = `
        const assert = require("node:assert/strict");
        const fs = require("node:fs");
        const { JsonSerializer } = require(${JSON.stringify(serializerPath)});
        const { ProcessLifecycle } = require(${JSON.stringify(lifecyclePath)});
        const dir = fs.mkdtempSync("/tmp/meowcord-json-stream-native-");
        const values = Array.from({length:32}, (_,id)=>({id,text:"🏳️‍⚧️ 日本語"}));
        const bytes = new TextEncoder().encode(JSON.stringify(values));
        const collect = async (iterator) => {const result=[];for await(const value of iterator)result.push(value);return result};
        try {
            const web = new ReadableStream({start(controller){for(const byte of bytes)controller.enqueue(Uint8Array.of(byte));controller.close()}});
            assert.deepEqual(await collect(JsonSerializer.DeserializeAsyncEnumerable(web)), values);
            assert.equal(web.locked, false);
            fs.writeFileSync(dir+"/input.json", bytes);
            const input = fs.createReadStream(dir+"/input.json",{highWaterMark:1});
            assert.deepEqual(await collect(JsonSerializer.DeserializeAsyncEnumerable(input)), values);
            assert.equal(input.closed, true);
            const output = fs.createWriteStream(dir+"/output.json",{highWaterMark:1});
            await JsonSerializer.SerializeAsyncEnumerableAsync((async function*(){yield*values})(),output);
            assert.equal(output.closed,true);
            assert.deepEqual(JSON.parse(fs.readFileSync(dir+"/output.json","utf8")),values);
            const chunks=[];
            const sink=new WritableStream({write(chunk){chunks.push(Buffer.from(chunk))}});
            await JsonSerializer.SerializeAsyncEnumerableAsync((async function*(){yield*values})(),sink);
            assert.equal(sink.locked,false);
            assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()),values);
            await ProcessLifecycle.Shutdown();
            await ProcessLifecycle.Finalize();
            console.log(JSON.stringify({fileItems:32,webItems:32,outputs:2,unicodePreserved:true,readersReleased:true,writersReleased:true}));
        }finally{fs.rmSync(dir,{recursive:true,force:true})}
    `;
    const child = spawnSync(process.execPath, ["-e", source], {
        encoding: "utf8",
        timeout: 5000,
        env: { ...process.env, JSON_WORKERS: "1", NOTIFY_SOCKET: "", TRACE_ACTIVE_HANDLES: "" },
    });
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout.trim()), {
        fileItems: 32,
        webItems: 32,
        outputs: 2,
        unicodePreserved: true,
        readersReleased: true,
        writersReleased: true,
    });
});

test("normal file decoding preserves a caller-owned descriptor with autoClose disabled", async () => {
    const dir = fixture();
    let stream;
    try {
        const file = path.join(dir, "owned.json");
        fs.writeFileSync(file, JSON.stringify(unicode));
        const descriptor = fs.openSync(file, "r");
        stream = fs.createReadStream(file, { fd: descriptor, autoClose: false, highWaterMark: 1 });
        assert.deepEqual(await serializer.DeserializeAsync(stream), unicode);
        assert.equal(fs.fstatSync(descriptor).isFile(), true);
        await new Promise((resolve, reject) => stream.close((error) => (error ? reject(error) : resolve())));
    } finally {
        stream?.destroy();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("JSON input counts split surrogate pairs as their combined UTF-8 encoding and preserves state after overflow", () => {
    const { JsonInput } = require("../../dist/util/util/json/JsonInput.js");
    const input = new JsonInput(6);
    input.append('"');
    input.append("\ud83d");
    input.append("");
    input.append("\ude00");
    input.append('"');
    assert.equal(input.value, '"😀"');
    assert.throws(
        () => input.append(" "),
        (error) => error.code === "JSON_QUEUE_FULL",
    );
    assert.equal(input.value, '"😀"');
    input.close();
});

test("JSON input byte accounting agrees with concatenation for mixed UTF-16 chunk boundaries", () => {
    const { JsonInput } = require("../../dist/util/util/json/JsonInput.js");
    for (const text of ["é日本語", "😀🏳️‍⚧️", "\ud83dx\ude00", "\ud83d\ud83d\ude00", "\ude00\ud83d"]) {
        const input = new JsonInput(Buffer.byteLength(text));
        for (let index = 0; index < text.length; index++) {
            input.append(text[index]);
            assert.equal(input.bytes, Buffer.byteLength(text.slice(0, index + 1)));
        }
        assert.equal(input.value, text);
        input.close();
    }
});

test("oversized whole-value web input cancels and releases its reader before worker admission", async () => {
    const { maxJsonInputBytes } = require("../../dist/util/util/json/JsonInput.js");
    const chunk = " ".repeat(65536);
    let pulls = 0;
    let cancelled = 0;
    const stream = new ReadableStream({
        pull(controller) {
            pulls++;
            controller.enqueue(chunk);
        },
        cancel() {
            cancelled++;
        },
    });
    await assert.rejects(serializer.DeserializeAsync(stream), (error) => error.code === "JSON_QUEUE_FULL");
    assert.equal(cancelled, 1);
    assert.equal(stream.locked, false);
    assert.ok(pulls <= maxJsonInputBytes / chunk.length + 2);
});

test("oversized whole-value file input closes its native stream before worker admission", async () => {
    const { maxJsonInputBytes } = require("../../dist/util/util/json/JsonInput.js");
    const dir = fixture();
    try {
        const file = path.join(dir, "oversized.json");
        const fd = fs.openSync(file, "w");
        try {
            fs.ftruncateSync(fd, maxJsonInputBytes + 1);
        } finally {
            fs.closeSync(fd);
        }
        const stream = fs.createReadStream(file, { highWaterMark: 65536 });
        await assert.rejects(serializer.DeserializeAsync(stream), (error) => error.code === "JSON_QUEUE_FULL");
        assert.equal(stream.closed, true);
        assert.equal(stream.destroyed, true);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

function arrayInputFixture(limit) {
    const { JsonInput } = require("../../dist/util/util/json/JsonInput.js");
    const module = { exports: {} };
    let appends = 0;
    vm.runInNewContext(fs.readFileSync("dist/util/util/json/JsonArray.js", "utf8"), {
        module,
        exports: module.exports,
        SyntaxError,
        require(name) {
            assert.equal(name, "./JsonInput");
            return {
                JsonInput: class extends JsonInput {
                    constructor() {
                        super(limit);
                    }
                    append(chunk) {
                        appends++;
                        super.append(chunk);
                    }
                },
            };
        },
    });
    return { parse: module.exports.parseJsonArray, appends: () => appends };
}

test("array entries reject overflow before parsing and return the unfinished source", async () => {
    const h = arrayInputFixture(12);
    let returned = false;
    let parsed = 0;
    async function* source() {
        try {
            yield '[1,"';
            yield "éééééé";
            yield '"]';
        } finally {
            returned = true;
        }
    }
    const iterator = h.parse(source(), async (value) => {
        parsed++;
        return JSON.parse(value);
    });
    assert.equal((await iterator.next()).value, 1);
    await assert.rejects(iterator.next(), (error) => error.code === "JSON_QUEUE_FULL");
    assert.equal(parsed, 1);
    assert.equal(returned, true);
});

test("array input resets its byte budget per entry while the full streamed array exceeds it", async () => {
    const h = arrayInputFixture(12);
    const values = ["ééééé", "ééééé", "ééééé"];
    const text = JSON.stringify(values);
    assert.ok(Buffer.byteLength(text) > 12);
    assert.deepEqual(await collect(h.parse(items([text]), async (value) => JSON.parse(value))), values);
    assert.ok(h.appends() <= values.length + 1);
});

test("array entry limits preserve split surrogate pairs and nested syntax across every chunk boundary", async () => {
    const h = arrayInputFixture(32);
    const values = [{ x: ["😀", 'a,b]\\"'] }, "🏳️‍⚧️"];
    const text = JSON.stringify(values);
    for (let index = 1; index < text.length; index++) {
        const chunks = [text.slice(0, index), text.slice(index)];
        assert.deepEqual(await collect(h.parse(items(chunks), async (value) => JSON.parse(value))), values);
    }
});

test("array entry input is accumulated in source segments rather than individual characters", async () => {
    const h = arrayInputFixture(65536);
    const text = JSON.stringify(["x".repeat(60000)]);
    assert.deepEqual(await collect(h.parse(items([text]), async (value) => JSON.parse(value))), ["x".repeat(60000)]);
    assert.equal(h.appends(), 1);
});

test("JSON accumulators share one byte budget and idempotent close restores admission", () => {
    const { JsonInput, maxJsonInputBytes } = require("../../dist/util/util/json/JsonInput.js");
    const readers = [new JsonInput(), new JsonInput(), new JsonInput()];
    const chunk = "x".repeat(maxJsonInputBytes / 2);
    try {
        readers[0].append(chunk);
        readers[1].append(chunk);
        assert.equal(JsonInput.retainedBytes, maxJsonInputBytes);
        assert.throws(
            () => readers[2].append("x"),
            (error) => error.code === "JSON_QUEUE_FULL",
        );
        assert.equal(readers[2].value, "");
        readers[0].close();
        readers[0].close();
        assert.equal(JsonInput.retainedBytes, maxJsonInputBytes / 2);
        readers[2].append(chunk);
        assert.equal(JsonInput.retainedBytes, maxJsonInputBytes);
        assert.throws(() => readers[0].append("x"), /closed/);
    } finally {
        for (const reader of readers) reader.close();
    }
    assert.equal(JsonInput.retainedBytes, 0);
});

test("shared accumulator overload cancels whole-value and array web readers without evicting accepted input", async () => {
    const { JsonInput, maxJsonInputBytes } = require("../../dist/util/util/json/JsonInput.js");
    const held = new JsonInput();
    held.append("x".repeat(maxJsonInputBytes));
    try {
        for (const enumerable of [false, true]) {
            let cancelled = 0;
            const stream = new ReadableStream({
                start(controller) {
                    controller.enqueue("[1]");
                },
                cancel() {
                    cancelled++;
                },
            });
            const reading = enumerable ? collect(serializer.DeserializeAsyncEnumerable(stream)) : serializer.DeserializeAsync(stream);
            await assert.rejects(reading, (error) => error.code === "JSON_QUEUE_FULL");
            assert.equal(cancelled, 1);
            assert.equal(stream.locked, false);
            assert.equal(JsonInput.retainedBytes, maxJsonInputBytes);
            assert.equal(held.value.length, maxJsonInputBytes);
        }
    } finally {
        held.close();
    }
    assert.equal(JsonInput.retainedBytes, 0);
    assert.deepEqual(await serializer.DeserializeAsync(bytesStream("{}")), {});
    assert.equal(JsonInput.retainedBytes, 0);
});

test("whole-value parse and source failures release every input reservation", async () => {
    const { JsonInput } = require("../../dist/util/util/json/JsonInput.js");
    await assert.rejects(serializer.DeserializeAsync(bytesStream('{"unfinished":')), SyntaxError);
    assert.equal(JsonInput.retainedBytes, 0);
    let pulls = 0;
    const failed = new ReadableStream({
        pull(controller) {
            if (pulls++ === 0) controller.enqueue('{"unfinished":');
            else controller.error(new Error("owned input failure"));
        },
    });
    await assert.rejects(serializer.DeserializeAsync(failed), /owned input failure/);
    assert.equal(failed.locked, false);
    assert.equal(JsonInput.retainedBytes, 0);
});

test("array parser reservations drain after awaited parsing, early return and parser or syntax failure", async () => {
    const { JsonInput } = require("../../dist/util/util/json/JsonInput.js");
    const h = arrayInputFixture(16);
    let release;
    let parsing = false;
    const gate = new Promise((resolve) => {
        release = resolve;
    });
    const iterator = h.parse(items(['["éé",2]']), async (value) => {
        parsing = true;
        await gate;
        return JSON.parse(value);
    });
    const first = iterator.next();
    while (!parsing) await turn();
    assert.equal(JsonInput.retainedBytes, 6);
    release();
    assert.equal((await first).value, "éé");
    await iterator.return();
    assert.equal(JsonInput.retainedBytes, 0);
    await assert.rejects(
        collect(
            h.parse(items(['["éé"]']), async () => {
                throw new Error("owned parse failure");
            }),
        ),
        /owned parse failure/,
    );
    assert.equal(JsonInput.retainedBytes, 0);
    await assert.rejects(collect(h.parse(items(['["éé']), async (value) => JSON.parse(value))), SyntaxError);
    assert.equal(JsonInput.retainedBytes, 0);
});

test("JSON reader count is shared by whole-value and array inputs stalled before their first byte", async () => {
    const { JsonInput } = require("../../dist/util/util/json/JsonInput.js");
    const controllers = [];
    const streams = [];
    const pending = Array.from({ length: 1024 }, (_, index) => {
        const stream = new ReadableStream({
            start(controller) {
                controllers.push(controller);
            },
        });
        streams.push(stream);
        return index % 2 ? collect(serializer.DeserializeAsyncEnumerable(stream)) : serializer.DeserializeAsync(stream);
    });
    const settled = Promise.allSettled(pending);
    try {
        await turn();
        assert.equal(JsonInput.activeInputs, 1024);
        assert.equal(JsonInput.retainedBytes, 0);
        assert.ok(streams.every((stream) => stream.locked));
        for (const enumerable of [false, true]) {
            let cancelled = 0;
            const rejected = new ReadableStream({
                cancel() {
                    cancelled++;
                },
            });
            const reading = enumerable ? collect(serializer.DeserializeAsyncEnumerable(rejected)) : serializer.DeserializeAsync(rejected);
            await assert.rejects(reading, (error) => error.code === "JSON_QUEUE_FULL");
            assert.equal(cancelled, 1);
            assert.equal(rejected.locked, false);
            assert.equal(JsonInput.activeInputs, 1024);
        }
    } finally {
        for (const controller of controllers) controller.error(new Error("owned reader cancellation"));
        const results = await settled;
        assert.ok(results.every((result) => result.status === "rejected"));
    }
    assert.ok(streams.every((stream) => !stream.locked));
    assert.equal(JsonInput.activeInputs, 0);
    assert.equal(JsonInput.retainedBytes, 0);
    assert.deepEqual(await serializer.DeserializeAsync(bytesStream("{}")), {});
    assert.equal(JsonInput.activeInputs, 0);
});

test("JSON reader overload closes whole-value and array file streams before acquiring a slot", async () => {
    const { JsonInput } = require("../../dist/util/util/json/JsonInput.js");
    const held = Array.from({ length: 1024 }, () => new JsonInput());
    const dir = fixture();
    try {
        const file = path.join(dir, "input.json");
        fs.writeFileSync(file, "[1]");
        for (const enumerable of [false, true]) {
            const stream = fs.createReadStream(file);
            const reading = enumerable ? collect(serializer.DeserializeAsyncEnumerable(stream)) : serializer.DeserializeAsync(stream);
            await assert.rejects(reading, (error) => error.code === "JSON_QUEUE_FULL");
            assert.equal(stream.destroyed, true);
            assert.equal(stream.closed, true);
            assert.equal(JsonInput.activeInputs, 1024);
        }
        held[0].close();
        held[0].close();
        const stream = fs.createReadStream(file);
        assert.deepEqual(await collect(serializer.DeserializeAsyncEnumerable(stream)), [1]);
        assert.equal(stream.closed, true);
        assert.equal(JsonInput.activeInputs, 1023);
    } finally {
        for (const input of held) input.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
    assert.equal(JsonInput.activeInputs, 0);
});
