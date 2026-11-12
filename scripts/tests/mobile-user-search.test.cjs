const assert = require("node:assert/strict");
const test = require("node:test");
const { sanitizeUserSearchMessage } = require("../../client/mobile/src/userSearch.ts");

test("users the native search worker can't decode are fixed or dropped", () => {
    const message = {
        type: "UPDATE_USERS",
        payload: [
            { id: "1", username: "tester", isBot: false, isFriend: true, globalName: "Tester", nicknames: { 10: "nick", 11: null } },
            { id: "2", globalName: "No Username", isBot: null },
            { id: 3, username: null, isFriend: "yes", nicknames: { 10: { bad: true } } },
            { username: "no id" },
            null,
        ],
    };
    const cleaned = JSON.parse(sanitizeUserSearchMessage(JSON.stringify(message)));
    assert.deepEqual(
        cleaned.payload.map((user) => [user.id, user.username, user.isBot, user.isFriend]),
        [
            ["1", "tester", false, true],
            ["2", "No Username", false, false],
            ["3", "3", false, false],
        ],
    );
    assert.deepEqual(cleaned.payload[0].nicknames, { 10: "nick", 11: null });
    assert.deepEqual(cleaned.payload[2].nicknames, { 10: null });
});

test("other worker messages pass through unchanged", () => {
    const query = JSON.stringify({ type: "QUERY_SET", uuid: "a", payload: { query: "te", limit: 10, boosters: false, boosterFallback: false } });
    assert.equal(sanitizeUserSearchMessage(query), query);
    assert.equal(sanitizeUserSearchMessage("not json"), "not json");
});
