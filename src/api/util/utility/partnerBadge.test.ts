import assert from "node:assert/strict";
import { test } from "node:test";
import { partnerBadgeRecipient } from "./partnerBadge";

test("the owner gets the partner badge when a server becomes partnered", () => {
    assert.equal(partnerBadgeRecipient({ owner_id: "owner", features: ["COMMUNITY"] }, { owner_id: "owner", features: ["COMMUNITY", "PARTNERED"] }), "owner");
});

test("a new owner of a partnered server gets the partner badge", () => {
    assert.equal(partnerBadgeRecipient({ owner_id: "old", features: ["PARTNERED"] }, { owner_id: "new", features: ["PARTNERED"] }), "new");
});

test("nothing is granted when partnership and ownership stay the same or the server isn't partnered", () => {
    assert.equal(partnerBadgeRecipient({ owner_id: "owner", features: ["PARTNERED"] }, { owner_id: "owner", features: ["PARTNERED", "COMMUNITY"] }), null);
    assert.equal(partnerBadgeRecipient({ owner_id: "owner", features: ["PARTNERED"] }, { owner_id: "owner", features: [] }), null);
    assert.equal(partnerBadgeRecipient({ owner_id: "old", features: [] }, { owner_id: "new", features: ["VERIFIED"] }), null);
});
