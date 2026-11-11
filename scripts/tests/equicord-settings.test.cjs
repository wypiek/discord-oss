const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const config = JSON.parse(fs.readFileSync("client/vencord.json", "utf8"));
const source = fs.readFileSync("scripts/vencord.js", "utf8");
const seed = vm.runInNewContext(`${source.slice(source.indexOf("const settingsKey ="), source.indexOf("const writeOutput ="))}seedDefaults`, { CONFIG: config });

function run(entries) {
    const values = new Map(Object.entries(entries));
    const localStorage = {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
    };
    vm.runInNewContext(seed({ plugins: config.plugins, settings: config.settings }), {
        localStorage,
        console,
    });
    return { values, settings: JSON.parse(values.get("EquicordSettings")) };
}

test("Equicord defaults keep ordinary typing visible and optional notifications disabled", () => {
    assert.equal(config.repository, "https://github.com/Equicord/Equicord");
    const { settings } = run({});
    assert.equal(settings.plugins.SilentTyping.enabledGlobally, false);
    assert.equal(settings.plugins.NewPluginsManager.enabled, false);
    assert.equal(settings.autoUpdate, false);
});

test("existing Vencord choices and custom CSS survive migration without rewriting legacy settings", () => {
    const legacy = JSON.stringify({
        plugins: { SilentTyping: { enabled: true, isEnabled: true }, WhoReacted: { enabled: false } },
        useQuickCss: false,
    });
    const { settings, values } = run({
        VencordSettings: legacy,
        FosscordVencordSeeded: JSON.stringify(["SilentTyping", 'SilentTyping:{"enabled":true,"isEnabled":false}', "WhoReacted"]),
    });
    assert.equal(settings.plugins.SilentTyping.enabledGlobally, true);
    assert.equal(settings.plugins.WhoReacted.enabled, false);
    assert.equal(settings.useQuickCss, false);
    assert.equal(values.get("VencordSettings"), legacy);
    const again = run(Object.fromEntries(values));
    assert.deepEqual(again.settings, settings);
});

test("existing Equicord settings take precedence over legacy Vencord settings", () => {
    const { settings } = run({
        EquicordSettings: JSON.stringify({
            plugins: { SilentTyping: { enabledGlobally: true } },
            useQuickCss: true,
        }),
        VencordSettings: JSON.stringify({ useQuickCss: false }),
        FosscordVencordSeeded: JSON.stringify(['SilentTyping:{"enabled":true,"isEnabled":false}']),
    });
    assert.equal(settings.useQuickCss, true);
    assert.equal(settings.plugins.SilentTyping.enabledGlobally, true);
});
