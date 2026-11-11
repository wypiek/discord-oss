const assert = require("node:assert/strict");
const { test } = require("node:test");
const { sourceMarker } = require("./helpers/source-marker.cjs");

test("source extraction ignores declaration indentation and keeps scoped searches", () => {
    for (const indent of ["", "  ", "    ", "\t"]) {
        const source = indent + "const value = 1;\n" + indent + "const section = () => {\n" + indent + "const value = 2;\n};\n" + indent + "render();";
        const section = sourceMarker(source, "    const section =");
        const value = sourceMarker(source, "        const value =", section);
        const end = sourceMarker(source, "\n    render();", section);
        assert.equal(source.slice(value, value + 16), "const value = 2;");
        assert.equal(source.slice(end), "render();");
    }
});

test("missing extraction markers fail immediately instead of producing empty browser scripts", () => {
    assert.throws(() => sourceMarker("const present = 1;", "    const missing ="), /Source extraction marker is missing/);
    assert.throws(() => sourceMarker("const present = 1;", "const present", -1), /valid starting position/);
    assert.throws(() => sourceMarker("const present = 1;", "   "), /nonempty marker/);
});
