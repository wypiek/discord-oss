const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const { entity, In, IsNull, Not, load } = require("./fake-orm.cjs");

const stayed = "1300000000000000001";
const left = "1300000000000000002";
const stranger = "1300000000000000003";
const latecomer = "1300000000000000004";
const group = "1300000000000000100";
const elsewhere = "1300000000000000200";

function e2ee() {
    const db = {
        Recipient: entity("Recipient", ["channel_id", "user_id"]),
        FormerRecipient: entity("FormerRecipient", ["channel_id", "user_id"]),
        Relationship: entity("Relationship", ["from_id", "to_id"]),
    };
    db.Recipient.rows.push(
        { id: "1", channel_id: group, user_id: stayed },
        { id: "2", channel_id: elsewhere, user_id: stranger },
        { id: "3", channel_id: group, user_id: latecomer },
    );
    db.FormerRecipient.rows.push({ channel_id: group, user_id: left }, { channel_id: elsewhere, user_id: stayed });
    const module = load("src/api/util/utility/e2ee.ts", {
        "node:crypto": crypto,
        typeorm: { In, IsNull, Not },
        "@spacebar/database": db,
        "@spacebar/util": { ApiError: class {}, Config: { get: () => ({}) } },
        "@spacebar/schemas": { ChannelType: {}, MessageType: {}, RelationshipType: { FRIEND: 1 } },
        "../../middlewares/RateLimit": () => () => {},
    });
    return { module, db };
}

test("members who stayed in a group DM get the keys of someone who left it", async () => {
    const { module } = e2ee();
    const allowed = await module.sharesE2eeContext(stayed, [left, stranger]);
    assert.ok(allowed.has(left), "the former member's keys are served to a remaining member");
    assert.ok(!allowed.has(stranger), "someone who never shared a group gets nothing");
});

test("only friendship opens keys outside a shared conversation", async () => {
    const { module, db } = e2ee();
    const [ignored, requested, friend] = ["1300000000000000011", "1300000000000000012", "1300000000000000013"];
    db.Relationship.rows.push(
        { from_id: stranger, to_id: ignored, type: 0, user_ignored: true },
        { from_id: stranger, to_id: requested, type: 4 },
        { from_id: stranger, to_id: friend, type: 1 },
    );
    const allowed = await module.sharesE2eeContext(stranger, [ignored, requested, friend]);
    assert.ok(!allowed.has(ignored), "ignoring someone doesn't open their keys");
    assert.ok(!allowed.has(requested), "a pending friend request doesn't open their keys");
    assert.ok(allowed.has(friend), "a friend's keys are served");
});

test("a former member record only opens keys to people currently in that channel", async () => {
    const { module } = e2ee();
    assert.ok((await module.sharesE2eeContext(latecomer, [left])).has(left), "anyone in the group now can check the history of the people who left it");
    assert.ok(!(await module.sharesE2eeContext(stranger, [left])).has(left), "a member of another conversation gets nothing");
    assert.ok(!(await module.sharesE2eeContext(left, [stayed])).has(stayed), "leaving a group doesn't let the person who left keep fetching the members' keys");
});
