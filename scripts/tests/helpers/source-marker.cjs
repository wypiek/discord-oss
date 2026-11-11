const assert = require("node:assert/strict");

function sourceMarker(source, marker, start = 0) {
    assert.ok(Number.isInteger(start) && start >= 0, "Source extraction requires a valid starting position");
    const token = marker.trimStart();
    assert.ok(token.length > 0, "Source extraction requires a nonempty marker");
    const position = source.indexOf(token, start);
    assert.notEqual(position, -1, "Source extraction marker is missing: " + token);
    return position;
}

module.exports = { sourceMarker };
