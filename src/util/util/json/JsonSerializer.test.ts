import { JsonSerializer } from "./JsonSerializer";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { JsonValue } from "@protobuf-ts/runtime";

describe("JsonSerializer", () => {
    it("should serialize synchronously", () => {
        const obj = { a: 1, b: "test" };
        const result = JsonSerializer.Serialize(obj);
        assert.equal(result, '{"a":1,"b":"test"}');
    });

    it("should deserialize synchronously", () => {
        const json = '{"a":1,"b":"test"}';
        const result = JsonSerializer.Deserialize(json);
        assert.deepEqual(result, { a: 1, b: "test" });
    });

    it("should serialize asynchronously", async () => {
        const obj = { a: 1, b: "test" };
        const result = await JsonSerializer.SerializeAsync(obj);
        assert.equal(result, '{"a":1,"b":"test"}');
    });

    it("should deserialize asynchronously", async () => {
        const json = '{"a":1,"b":"test"}';
        const result = await JsonSerializer.DeserializeAsync(json);
        assert.deepEqual(result, { a: 1, b: "test" });
    });

    const nestedArray = (length: number, width: number, depth: number) => {
        const build = (level: number): JsonValue => (level === 0 ? {} : Object.fromEntries(Array.from({ length: width }, (_, i) => [`key${i}`, build(level - 1)])));
        return JSON.stringify(Array.from({ length }, () => build(depth)));
    };

    it("should deserialize a large document", async () => {
        const obj = await JsonSerializer.DeserializeAsync<JsonValue[]>(nestedArray(100, 10, 5));
        assert.equal(obj.length, 100);
    });

    it("should deserialize in parallel", async () => {
        const json = nestedArray(50, 5, 5);
        const results = await Promise.all(Array.from({ length: 64 }, () => JsonSerializer.DeserializeAsync<JsonValue[]>(json)));
        for (const obj of results) assert.equal(obj.length, 50);
    });
});
