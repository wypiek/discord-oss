const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const sources = (directory) =>
    fs
        .readdirSync(directory, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name))
        .flatMap((entry) => {
            const full = path.join(directory, entry.name);
            if (entry.isDirectory()) return sources(full);
            return entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") && !entry.name.endsWith(".test.ts") ? [full] : [];
        });

test("every outbound fetch in the server has an abort signal", () => {
    const missing = [];
    for (const file of sources("src")) {
        const text = fs.readFileSync(file, "utf8");
        if (!text.includes("fetch(")) continue;
        const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
        const visit = (node) => {
            if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "fetch") {
                const options = node.arguments[1];
                const hasSignal =
                    options &&
                    (!ts.isObjectLiteralExpression(options) ||
                        options.properties.some((property) => property.name?.getText(source) === "signal" || ts.isSpreadAssignment(property)));
                if (!hasSignal) missing.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
    }
    assert.deepEqual(missing, []);
});
