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
const valuesSource = source.slice(
    sourceMarker(source, "        const rows = Object.entries(values)"),
    sourceMarker(source, "        const endpoint = ", sourceMarker(source, "        const rows = Object.entries(values)")),
);
for (const browserName of ["chromium", "webkit"]) {
    test(`${browserName} pending widget value saves preserve newer drafts`, {
        skip: !playwright || (browserName === "chromium" && !fs.existsSync(executablePath)),
        timeout: 30000,
    }, async () => {
        const browser = await playwright[browserName].launch(browserName === "chromium" ? { executablePath, headless: true } : { headless: true });
        try {
            for (const scenario of ["unchanged", "value-edit", "key-edit", "add-row", "remove-row", "duplicate-input", "failure", "stale", "detached", "stale-failure"]) {
                const page = await browser.newPage();
                try {
                    await page.setContent("<!doctype html><main id=view></main><button id=outside>Outside</button>");
                    await page.addScriptTag({
                        content: `let renderVersion=0;const version=renderVersion;let valueEditVersion=0;${elements};${messages};const app={id:"111"};const values={visits:"initial"};const state={};const dataKeys=()=>[];window.previewCalls=0;const drawPreview=()=>previewCalls++;window.requests=[];const api=(method,path,body)=>{requests.push(JSON.parse(JSON.stringify(body)));return new Promise((resolve,reject)=>{window.releaseValues=resolve;window.rejectValues=reject;});};${valuesSource};document.querySelector("#view").append(dataCard);window.oldValuesCard=dataCard;window.valueRows=rowList;`,
                    });
                    await page.getByRole("textbox", { name: "Value 1", exact: true }).fill("submitted");
                    const action = page.getByRole("button", { name: "Save values", exact: true });
                    await action.evaluate((button) => (window.pendingValuesButton = button));
                    await action.click();
                    assert.equal(await action.isDisabled(), true);
                    assert.deepEqual(await page.evaluate(() => requests), [{ data: { visits: "submitted" } }]);
                    if (scenario === "value-edit" || scenario === "failure") await page.getByRole("textbox", { name: "Value 1", exact: true }).fill("new draft");
                    if (scenario === "key-edit") await page.getByRole("textbox", { name: "Key 1", exact: true }).fill("new_key");
                    if (scenario === "add-row") await page.getByRole("button", { name: "Add value", exact: true }).click();
                    if (scenario === "remove-row") await page.getByRole("button", { name: "Remove visits", exact: true }).click();
                    if (scenario === "duplicate-input") await page.getByRole("textbox", { name: "Value 1", exact: true }).fill("submitted");
                    await page.evaluate((scenario) => {
                        window.draftInputs = [...valueRows.querySelectorAll("input")];
                        if (scenario.startsWith("stale")) renderVersion++;
                        if (scenario.startsWith("stale") || scenario === "detached") document.querySelector("#view").replaceChildren(document.createTextNode("Current page"));
                    }, scenario);
                    await page.locator("#outside").focus();
                    await page.evaluate((scenario) => {
                        if (scenario.endsWith("failure")) rejectValues(new Error("Synthetic value save failure"));
                        else releaseValues({ data: { visits: "submitted" } });
                    }, scenario);
                    await page.waitForFunction(() => !pendingValuesButton.disabled);
                    if (["value-edit", "key-edit", "add-row", "remove-row"].includes(scenario)) {
                        assert.equal(await page.evaluate(() => draftInputs.every((input) => input.isConnected)), true, "New draft inputs must survive the older response");
                        assert.equal(await page.getByRole("status").textContent(), "Values saved. You have unsaved changes.");
                        if (scenario === "value-edit") assert.equal(await page.getByRole("textbox", { name: "Value 1", exact: true }).inputValue(), "new draft");
                        if (scenario === "key-edit") assert.equal(await page.getByRole("textbox", { name: "Key 1", exact: true }).inputValue(), "new_key");
                        assert.equal(await page.locator(".wp-data-row").count(), scenario === "add-row" ? 2 : scenario === "remove-row" ? 0 : 1);
                    } else if (scenario === "failure") {
                        assert.equal(await page.getByRole("textbox", { name: "Value 1", exact: true }).inputValue(), "new draft");
                        assert.equal(await page.getByRole("alert").textContent(), "Synthetic value save failure");
                    } else if (scenario.startsWith("stale") || scenario === "detached") {
                        assert.equal(await page.locator("#view").textContent(), "Current page");
                        assert.equal(await page.evaluate(() => previewCalls), 0);
                        assert.equal(await page.evaluate(() => oldValuesCard.querySelector("[role=alert]").hidden), true);
                    } else assert.equal(await page.getByRole("status").textContent(), "Values saved.");
                } finally {
                    await page.close();
                }
            }
        } finally {
            await browser.close();
        }
    });
}
