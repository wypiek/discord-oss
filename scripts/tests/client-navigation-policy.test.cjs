const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const patch = (plugin, route) => {
    const source = fs.readFileSync(`client/plugins/${plugin}/index.ts`, "utf8");
    const block = source.slice(source.indexOf(`find: /\\[\\i\\.\\i\\.${route}`));
    const canonicalize = (literal) => {
        const expression = vm.runInNewContext(literal);
        return new RegExp(expression.source.replaceAll("\\i", "(?:[A-Za-z_$][\\w$]*)"), expression.flags);
    };
    return { find: canonicalize(block.match(/find: (\/[^\n]+\/),/)[1]), match: canonicalize(block.match(/match: (\/[^\n]+\/[gim]*),/)[1]) };
};

test("navigation policy selects the route table instead of the forwarding search method", () => {
    const forwarding = "queryInAppNavigations(e,t){return search.queryInAppNavigations({query:e,limit:t})}";
    const table =
        '[routes.ids.NITRO_HOME]:[intl.intl.string(intl.t.Premium)],[routes.ids.SHOP_ORBS_TAB]:[intl.intl.string(intl.t.Orbs),intl.intl.string(intl.t["other/key"])],[routes.ids.QUEST_ORBS]:[intl.intl.string(intl.t.QuestOrbs)],[routes.ids.QUEST_HOME]:[intl.intl.string(intl.t.Quests)],[routes.ids.SHOP]:[intl.intl.string(intl.t.FreeShop)],[routes.ids.APPS_HOME]:[intl.intl.string(intl.t.Apps)]';
    const nitro = patch("fosscordNoNitroUpsells", "NITRO_HOME");
    const quests = patch("fosscordNoQuests", "SHOP_ORBS_TAB");
    assert.equal(nitro.find.test(forwarding), false);
    assert.equal(quests.find.test(forwarding), false);
    assert.equal(nitro.find.test(table), true);
    assert.equal(quests.find.test(table), true);
    const updated = table.replace(nitro.match, "$1null").replace(quests.match, "$1null");
    for (const route of ["NITRO_HOME", "SHOP_ORBS_TAB", "QUEST_ORBS", "QUEST_HOME"]) assert.ok(updated.includes(`[routes.ids.${route}]:null`));
    assert.ok(updated.includes("[routes.ids.SHOP]:[intl.intl.string(intl.t.FreeShop)]"));
    assert.ok(updated.includes("[routes.ids.APPS_HOME]:[intl.intl.string(intl.t.Apps)]"));
});
