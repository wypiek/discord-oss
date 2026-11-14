import assert from "node:assert/strict";
import { test } from "node:test";
import { updatedImageHash } from "./imageField";

const upload = async (dataUri: string) => `uploaded:${dataUri.length}`;
const refuse = async () => {
    throw new Error("upload should not run");
};

test("an image field left out keeps the current hash", async () => {
    assert.equal(await updatedImageHash("abc", undefined, refuse), "abc");
    assert.equal(await updatedImageHash(undefined, undefined, refuse), null);
});

test("an image field sent back unchanged keeps the current hash", async () => {
    assert.equal(await updatedImageHash("abc", "abc", refuse), "abc");
    assert.equal(await updatedImageHash("a_abc", "a_abc", refuse), "a_abc");
});

test("null or an empty string removes the image", async () => {
    assert.equal(await updatedImageHash("abc", null, refuse), null);
    assert.equal(await updatedImageHash("abc", "", refuse), null);
});

test("a data uri is uploaded", async () => {
    assert.equal(await updatedImageHash("abc", "data:image/png;base64,AAAA", upload), "uploaded:26");
});

test("an unknown hash keeps the current image instead of removing it", async () => {
    assert.equal(await updatedImageHash("abc", "def", refuse), "abc");
    assert.equal(await updatedImageHash(null, "def", refuse), null);
});
