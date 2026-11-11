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
const deletion = source.slice(sourceMarker(source, "        const removeError ="), sourceMarker(source, "        removeCard.hidden ="));
for (const browserName of ["chromium", "webkit"]) {
    test(`${browserName} widget deletion keeps only its current editor UI`, {
        skip: !playwright || (browserName === "chromium" && !fs.existsSync(executablePath)),
        timeout: 30000,
    }, async () => {
        const browser = await playwright[browserName].launch(browserName === "chromium" ? { executablePath, headless: true } : { headless: true });
        try {
            for (const scenario of [
                "current-success",
                "current-failure",
                "stale-success",
                "stale-failure",
                "detached-success",
                "detached-failure",
                "stale-confirmation",
                "cancelled-confirmation",
            ]) {
                const page = await browser.newPage();
                try {
                    await page.setContent("<!doctype html><main id=view></main><button id=outside>Outside</button>");
                    await page.addScriptTag({
                        content: `let renderVersion=0;const version=renderVersion;${elements};${messages};const app={id:"111"};window.renderCalls=0;const render=async()=>renderCalls++;window.deleteCalls=0;const api=()=>{deleteCalls++;return new Promise((resolve,reject)=>{window.releaseDelete=resolve;window.rejectDelete=reject;});};const confirmDialog=()=>new Promise(resolve=>window.releaseDecision=resolve);${deletion};document.querySelector("#view").append(removeCard);window.originalCard=removeCard;`,
                    });
                    const action = page.getByRole("button", { name: "Delete widget", exact: true });
                    await action.evaluate((button) => (window.oldDeleteButton = button));
                    await action.click();
                    await page.waitForFunction(() => window.releaseDecision);
                    if (scenario === "stale-confirmation")
                        await page.evaluate(() => {
                            renderVersion++;
                            document.querySelector("#view").replaceChildren(document.createTextNode("Current page"));
                        });
                    await page.evaluate(async (scenario) => {
                        releaseDecision(scenario !== "cancelled-confirmation");
                        await new Promise((resolve) => setTimeout(resolve, 0));
                    }, scenario);
                    if (scenario.endsWith("confirmation")) {
                        assert.equal(await page.evaluate(() => deleteCalls), 0, "Dismissed or obsolete confirmation must not submit deletion");
                        continue;
                    }
                    await page.waitForFunction(() => window.releaseDelete);
                    assert.equal(await page.evaluate(() => oldDeleteButton.disabled), true);
                    await page.evaluate((scenario) => {
                        if (scenario.startsWith("stale-")) renderVersion++;
                        if (!scenario.startsWith("current-")) document.querySelector("#view").replaceChildren(document.createTextNode("Current page"));
                    }, scenario);
                    await page.locator("#outside").focus();
                    await page.evaluate((scenario) => {
                        if (scenario.endsWith("failure")) rejectDelete(new Error("Synthetic widget deletion failure"));
                        else releaseDelete({});
                    }, scenario);
                    await page.waitForFunction(() => !oldDeleteButton.disabled);
                    assert.equal(await page.evaluate(() => renderCalls), scenario === "current-success" ? 1 : 0, "An obsolete deletion must not refresh current UI");
                    if (scenario === "current-failure") assert.equal(await page.getByRole("alert").filter({ hasText: "Synthetic widget deletion failure" }).count(), 1);
                    else if (scenario !== "current-success") {
                        assert.equal(await page.locator("#view").textContent(), "Current page");
                        assert.equal(await page.evaluate(() => document.activeElement.id), "outside");
                        assert.equal(await page.evaluate(() => originalCard.querySelector("[role=alert]").hidden), true);
                    }
                } finally {
                    await page.close();
                }
            }
        } finally {
            await browser.close();
        }
    });
}
