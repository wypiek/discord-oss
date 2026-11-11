const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const compile = (file) =>
    ts.transpileModule(fs.readFileSync(file, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
    }).outputText;

const harness = () => {
    const users = new Map();
    const requests = [];
    const module = { exports: {} };
    const React = {
        createElement: (type, props, ...children) =>
            typeof type === "function" ? type({ ...props, children: children.length > 1 ? children : children[0] }) : { type, props: { ...props, children } },
        Fragment: "fragment",
    };
    let effects = [];
    vm.runInNewContext(compile("client/plugins/fosscordPride/flags.tsx"), {
        module,
        exports: module.exports,
        React,
        Date,
        require(name) {
            if (name === "@webpack/common")
                return {
                    RestAPI: { get: ({ url }) => new Promise((resolve, reject) => requests.push({ url, resolve, reject })) },
                    Tooltip: ({ text, children }) => ({ tooltip: text, child: children({ "aria-describedby": "tip" }) }),
                    UserStore: { getUser: (id) => users.get(id) },
                    useStateFromStores: (_stores, read) => read(),
                    useState: (value) => [value, () => {}],
                    useEffect: (effect) => effects.push(effect),
                };
            throw Error(name);
        },
    });
    const render = (props) => {
        effects = [];
        const element = module.exports.PrideFlags(props);
        for (const effect of effects) effect();
        return element;
    };
    return { ...module.exports, users, requests, render };
};

const catalog = [
    { slug: "rainbow", description: "Rainbow", icon_url: "/badge-icons/pride_rainbow.png" },
    { slug: "transgender", description: "Transgender", icon_url: "/badge-icons/pride_transgender.png" },
    { slug: "bisexual", description: "Bisexual", icon_url: "/badge-icons/pride_bisexual.png" },
    { slug: "nonbinary", description: "Nonbinary", icon_url: "/badge-icons/pride_nonbinary.png" },
];
const byslug = new Map(catalog.map((flag) => [flag.slug, flag]));

test("flags keep the picked order, drop duplicates and skip slugs the catalog doesn't know", () => {
    const h = harness();
    const flags = h.resolveFlags(["transgender", "rainbow", "transgender", "future-flag"], byslug);
    assert.deepEqual(
        Array.from(flags, (flag) => flag.slug),
        ["transgender", "rainbow"],
    );
    assert.equal(h.resolveFlags(null, byslug).length, 0);
});

test("payload selections are interned so unchanged flags never replace the user record", () => {
    const h = harness();
    const first = h.internFlags(["rainbow", "transgender", "rainbow"]);
    assert.deepEqual([...first], ["rainbow", "transgender"]);
    assert.equal(h.internFlags(["rainbow", "transgender"]), first);
    assert.ok(Object.isFrozen(first));
    assert.equal(h.internFlags("rainbow").length, 0);
    assert.deepEqual([...h.internFlags([1, null, "x".repeat(65), "bisexual"])], ["bisexual"]);
    const raw = { id: "1", pride_badges: ["rainbow", "transgender"] };
    h.prepareUser(raw);
    assert.equal(raw.prideBadges, first);
    assert.equal("pride_badges" in raw, false);
    const untouched = { id: "1" };
    h.prepareUser(untouched);
    assert.equal("prideBadges" in untouched, false);
    assert.equal(h.flagsFrom({ prideBadges: ["bisexual"], pride_badges: ["rainbow"] })[0], "bisexual");
    assert.equal(h.flagsFrom({ pride_badges: ["rainbow"] })[0], "rainbow");
    assert.equal(h.flagsFrom(undefined).length, 0);
});

test("flags render after the name with a label and tooltip each, capped with a +N that names every flag", async () => {
    const h = harness();
    h.users.set("friend", { id: "friend", prideBadges: h.internFlags(["nonbinary", "rainbow", "transgender", "bisexual"]) });
    assert.equal(h.render({ userId: "friend", max: 3 }), null);
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].url, "/auth/pride-badges");
    h.requests[0].resolve({ body: { badges: catalog } });
    await new Promise((resolve) => setImmediate(resolve));
    const group = h.render({ userId: "friend", max: 3 });
    assert.equal(h.requests.length, 1);
    assert.equal(group.props["aria-label"], "Pride flags");
    const [shown, more] = group.props.children;
    assert.deepEqual(
        Array.from(shown, (item) => [item.tooltip, item.child.props.alt, item.child.props.src]),
        [
            ["Nonbinary", "Nonbinary", "/badge-icons/pride_nonbinary.png"],
            ["Rainbow", "Rainbow", "/badge-icons/pride_rainbow.png"],
        ],
    );
    assert.equal(more.tooltip, "Nonbinary, Rainbow, Transgender, Bisexual");
    assert.equal(more.child.props["aria-label"], "2 more: Transgender, Bisexual");
    assert.deepEqual(more.child.props.children, ["+", 2]);
    const all = h.render({ userId: "friend", max: 4 }).props.children;
    assert.equal(all[0].length, 4);
    assert.equal(all[1], false);
    h.users.set("plain", { id: "plain", prideBadges: h.internFlags([]) });
    assert.equal(h.render({ userId: "plain", max: 3 }), null);
    assert.equal(h.render({ userId: "unknown", max: 3 }), null);
});

test("the pride plugin shows flags with the pronouns on profiles, even when no pronouns are set", () => {
    const plugin = fs.readFileSync("client/plugins/fosscordPride/index.tsx", "utf8");
    assert.match(plugin, /required:\s*true/);
    for (const hook of ["hasFlags", "pronounsWithFlags"]) assert.match(plugin, new RegExp(`${hook}:`));
    for (const hook of ["renderMessageDecoration", "renderMemberListDecorator", "nameTrailing"]) assert.doesNotMatch(plugin, new RegExp(`${hook}:`));
    assert.match(plugin, /find: "onClickDisplayName:"/);
    assert.match(plugin, /GI2A8C/);
    assert.match(plugin, /\$self\.hasFlags\(\$5\)/);
    assert.match(plugin, /find: "has_bounced_email\?\?"/);
    assert.match(plugin, /find: 'displayName="UserStore"'/);
    assert.match(plugin, /\["pride_badges","username","avatar","global_name"/);
    assert.doesNotMatch(plugin, /definePluginSettings|settings:/);
});
