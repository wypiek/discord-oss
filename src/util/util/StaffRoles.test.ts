import assert from "node:assert/strict";
import { test } from "node:test";
import { Rights } from "./Rights";
import { isInstanceStaff, StaffRoleSnapshot } from "./StaffRoles";

const snapshot: StaffRoleSnapshot = {
    roles: new Map([["moderators", { id: "moderators", name: "Moderators", color: null, rights: 0n, position: 1, show_badge: false }]]),
    members: new Map([["role-member", ["moderators"]]]),
};

test("operators, staff rights, staff roles and the staff flag all count as instance staff", () => {
    assert.ok(isInstanceStaff({ id: "operator", rights: Rights.FLAGS.OPERATOR }, snapshot));
    assert.ok(isInstanceStaff({ id: "moderator", rights: Rights.FLAGS.MODERATE_USERS }, snapshot));
    assert.ok(isInstanceStaff({ id: "role-member", rights: 0n }, snapshot));
    assert.ok(isInstanceStaff({ id: "flagged", rights: 0n, public_flags: 1 }, snapshot));
});

test("ordinary accounts are not instance staff", () => {
    assert.ok(!isInstanceStaff({ id: "member", rights: 0n, public_flags: 0 }, snapshot));
    assert.ok(!isInstanceStaff({ id: "member", rights: Rights.FLAGS.SEND_MESSAGES, public_flags: 64 }, snapshot));
});
