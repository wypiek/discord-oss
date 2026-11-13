const assert = require("node:assert/strict");
const test = require("node:test");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const INVALID_CHARACTER = /[<>:"|?*\\]/;
const hasControlCharacter = (part) => [...part].some((character) => character.charCodeAt(0) < 32);

test("every tracked path can be checked out on Windows", () => {
    const files = execFileSync("git", ["ls-files", "-z"], { cwd: path.join(__dirname, "..", ".."), encoding: "utf8" })
        .split("\0")
        .filter(Boolean);
    const invalid = files.filter((file) =>
        file.split("/").some((part) => INVALID_CHARACTER.test(part) || hasControlCharacter(part) || RESERVED_NAME.test(part) || part.endsWith(".") || part.endsWith(" ")),
    );
    assert.deepEqual(invalid, []);
});
