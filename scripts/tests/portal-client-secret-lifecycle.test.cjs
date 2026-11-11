const { sourceMarker } = require("./helpers/source-marker.cjs");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { homedir } = require("node:os");
const { chromiumPath } = require("../util/chromium.cjs");
let playwright;
try {
    playwright = createRequire(path.join(homedir(), ".cache/fosscord-tools/package.json"))("playwright-core");
} catch {}
const executablePath = chromiumPath();
const source = fs.readFileSync("assets/public/developers/portal.js", "utf8");
const elements = source.slice(sourceMarker(source, "    const el ="), sourceMarker(source, "    const errorText ="));
const messages = source.slice(sourceMarker(source, "    const statusLine ="), sourceMarker(source, "    const confirmDialog ="));
const clientSource = source.slice(
    sourceMarker(source, "        const secretError =", sourceMarker(source, "    const renderOAuth =")),
    sourceMarker(source, "        const redirects =", sourceMarker(source, "    const renderOAuth =")),
);
const helperStart = sourceMarker(source, "    const showPendingClientSecret =");
const helperSource = helperStart === -1 ? "" : source.slice(helperStart, sourceMarker(source, "    const createDialog =", helperStart));
for (const browserName of ["chromium", "webkit"]) {
    test(`${browserName} client secret resets stay serialized and scoped to their application`, {
        skip: !playwright || (browserName === "chromium" && !fs.existsSync(executablePath)),
        timeout: 60000,
    }, async () => {
        const browser = await playwright[browserName].launch(browserName === "chromium" ? { executablePath, headless: true } : { headless: true });
        try {
            for (const scenario of [
                "current",
                "failure",
                "empty",
                "cancel",
                "obsolete-confirmation",
                "stale-return",
                "early-return",
                "foreign",
                "duplicate",
                "detached",
                "stale-failure",
            ]) {
                const page = await browser.newPage();
                try {
                    await page.setContent("<!doctype html><main id=view></main>");
                    await page.addScriptTag({
                        content: `let renderVersion=0;const pendingClientSecrets=new Map();const pendingClientSecretResets=new Set();let currentClientSecret=null;${elements};${messages};const FLAGS={publicClient:1};const copyField=()=>document.createElement("span");const switchRow=()=>document.createElement("span");const flagToggle=()=>document.createElement("input");const secretBox=(id,label,value)=>el("input",{id,value,readonly:true,"aria-label":label});const confirmDialog=()=>new Promise(resolve=>window.confirmReset=resolve);window.resetRequests=0;const api=()=>{resetRequests++;return new Promise((resolve,reject)=>{window.finishReset=resolve;window.failReset=reject;});};${helperSource};window.mountClient=id=>{const version=++renderVersion;currentClientSecret=null;const app={id,flags:0};${clientSource};document.querySelector("#view").replaceChildren(clientCard);};window.readSecret=()=>document.querySelector("#client-secret")?.value;`,
                    });
                    await page.evaluate(() => mountClient("111"));
                    await page.getByRole("button", { name: "Reset secret", exact: true }).evaluate((button) => (window.originalReset = button));
                    await page.getByRole("button", { name: "Reset secret", exact: true }).click();
                    assert.equal(await page.evaluate(() => originalReset.disabled), true, "The reset opener must remain disabled during confirmation and submission");
                    if (scenario === "duplicate") await page.evaluate(() => originalReset.dispatchEvent(new MouseEvent("click")));
                    if (scenario === "obsolete-confirmation") await page.evaluate(() => mountClient("999"));
                    await page.evaluate((scenario) => confirmReset(scenario !== "cancel"), scenario);
                    if (["cancel", "obsolete-confirmation"].includes(scenario)) {
                        await page.waitForFunction(() => !originalReset.disabled);
                        assert.equal(await page.evaluate(() => resetRequests), 0);
                        continue;
                    }
                    await page.waitForFunction(() => window.finishReset);
                    if (scenario === "duplicate") await page.evaluate(() => originalReset.dispatchEvent(new MouseEvent("click")));
                    assert.equal(await page.evaluate(() => resetRequests), 1);
                    if (["stale-return", "foreign", "stale-failure"].includes(scenario)) await page.evaluate(() => mountClient("999"));
                    if (scenario === "early-return") {
                        await page.evaluate(() => mountClient("111"));
                        assert.equal(await page.getByRole("button", { name: "Reset secret", exact: true }).isDisabled(), true);
                    }
                    if (scenario === "detached") await page.evaluate(() => document.querySelector("#view").replaceChildren(document.createTextNode("Current page")));
                    await page.evaluate((scenario) => {
                        if (scenario.endsWith("failure")) failReset(new Error("Synthetic secret reset failure"));
                        else finishReset({ secret: scenario === "empty" ? "" : "fixture-111" });
                    }, scenario);
                    await page.waitForFunction(() => !originalReset.disabled);
                    if (scenario === "failure") assert.equal(await page.getByRole("alert").textContent(), "Synthetic secret reset failure");
                    else if (["foreign", "stale-return", "detached", "stale-failure", "empty"].includes(scenario)) assert.equal(await page.evaluate(() => readSecret()), undefined);
                    else await page.waitForFunction(() => readSecret() === "fixture-111");
                    if (["stale-return", "early-return", "detached"].includes(scenario)) {
                        if (scenario !== "early-return") {
                            await page.evaluate(() => mountClient("111"));
                            await page.waitForFunction(() => readSecret() === "fixture-111");
                        }
                        await page.evaluate(() => mountClient("111"));
                        await page.waitForTimeout(30);
                        assert.equal(await page.evaluate(() => readSecret()), undefined, "A presented secret must not appear again");
                    }
                    if (scenario === "foreign") assert.equal(await page.evaluate(() => pendingClientSecrets.has("111") && !pendingClientSecrets.has("999")), true);
                    if (scenario === "stale-failure") assert.equal(await page.getByRole("alert").filter({ hasText: "Synthetic secret reset failure" }).count(), 0);
                } finally {
                    await page.close();
                }
            }
        } finally {
            await browser.close();
        }
    });
}
