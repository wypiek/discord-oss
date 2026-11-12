import assert from "node:assert/strict";
import { test } from "node:test";
import { ChannelPermissionOverwrite } from "@spacebar/schemas";
import { copyOverwrites, sameOverwrites, syncedChildren } from "./categorySync";

const role = (id: string, allow: string, deny: string): ChannelPermissionOverwrite => ({ id, type: 0, allow, deny });

test("overwrites match regardless of order and number formatting", () => {
    assert.ok(sameOverwrites([role("1", "0", "1024"), role("2", "1024", "0")], [role("2", "1024", "0"), role("1", "0", "1024")]));
    assert.ok(sameOverwrites([{ id: "1", type: "0" as unknown as 0, allow: "8", deny: "0" }], [role("1", "8", "0")]));
    assert.ok(sameOverwrites(undefined, []));
    assert.ok(!sameOverwrites([role("1", "0", "1024")], [role("1", "0", "2048")]));
    assert.ok(!sameOverwrites([role("1", "0", "1024")], []));
});

test("only children that matched the category before the change are synced", () => {
    const before = [role("everyone", "0", "1024")];
    const children = [
        { id: "synced", permission_overwrites: [role("everyone", "0", "1024")] },
        { id: "custom", permission_overwrites: [role("everyone", "0", "1024"), role("mods", "1024", "0")] },
        { id: "empty", permission_overwrites: [] },
    ];
    assert.deepEqual(
        syncedChildren(before, children).map((child) => child.id),
        ["synced"],
    );
    assert.deepEqual(
        syncedChildren([], children).map((child) => child.id),
        ["empty"],
    );
});

test("copied overwrites don't share objects with the category", () => {
    const source = [role("1", "0", "1024")];
    const copy = copyOverwrites(source);
    copy[0].deny = "0";
    assert.equal(source[0].deny, "1024");
});
