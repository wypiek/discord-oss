const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

const configSource = ts.createSourceFile("CdnConfiguration.ts", fs.readFileSync("src/util/config/types/CdnConfiguration.ts", "utf8"), ts.ScriptTarget.ES2022, true);

const classes = new Map(
    configSource.statements
        .filter(ts.isClassDeclaration)
        .map((declaration) => [
            declaration.name.text,
            new Map(declaration.members.filter(ts.isPropertyDeclaration).map((member) => [member.name.getText(configSource), member.type?.getText(configSource) ?? ""])),
        ]),
);

const hasKey = (path) => {
    let properties = classes.get("CdnConfiguration");
    for (const [index, part] of path.entries()) {
        if (part === "endpointPublic" || part === "endpointPrivate") return index === path.length - 1;
        if (!properties?.has(part)) return false;
        properties = classes.get(properties.get(part));
    }
    return true;
};

test("every cdn config key the limits page names exists in the CDN config", () => {
    const docs = fs.readFileSync("docs/security/limits.md", "utf8");
    const keys = [...docs.matchAll(/`cdn\.([A-Za-z.]+)`/g)].map((match) => match[1]);
    assert.ok(keys.length > 0);
    for (const key of keys) assert.ok(hasKey(key.split(".")), `cdn.${key} is documented but not in CdnConfiguration`);
});

test("every class in the CDN config file is reachable from a config key", () => {
    const reachable = new Set(["CdnConfiguration"]);
    for (const name of reachable) for (const type of classes.get(name)?.values() ?? []) if (classes.has(type)) reachable.add(type);
    assert.deepEqual(
        [...classes.keys()].filter((name) => !reachable.has(name)),
        [],
    );
});
