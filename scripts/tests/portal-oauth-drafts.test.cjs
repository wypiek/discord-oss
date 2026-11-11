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
const redirectsSource = source.slice(
    sourceMarker(source, "        const redirects =", sourceMarker(source, "    const renderOAuth =")),
    sourceMarker(source, "        const scopes =", sourceMarker(source, "    const renderOAuth =")),
);
for (const browserName of ["chromium", "webkit"]) {
    test(`${browserName} OAuth redirect saves preserve newer drafts and their current editor`, {
        skip: !playwright || (browserName === "chromium" && !fs.existsSync(executablePath)),
        timeout: 60000,
    }, async () => {
        const browser = await playwright[browserName].launch(browserName === "chromium" ? { executablePath, headless: true } : { headless: true });
        try {
            for (const scenario of ["unchanged", "edit", "add", "remove", "clear", "restored", "failure", "edited-failure", "stale", "detached", "superseded", "stale-failure"]) {
                const page = await browser.newPage();
                try {
                    await page.setContent("<!doctype html><main id=view></main><button id=outside>Outside</button>");
                    await page.addScriptTag({
                        content: `let renderVersion=0;const version=renderVersion;${elements};${messages};const app={id:"111",redirect_uris:["https://example.com/first","https://example.com/second"]};window.updateCalls=0;const update=()=>updateCalls++;const api=(method,path,body)=>{window.submitted=body;return new Promise((resolve,reject)=>{window.releaseRedirect=resolve;window.rejectRedirect=reject;});};${redirectsSource};document.querySelector("#view").append(redirectsCard,redirectSelect);window.oldSave=saveRedirects;window.oldCard=redirectsCard;window.readDraft=()=>[...redirects];`,
                    });
                    await page.getByRole("button", { name: "Save changes", exact: true }).click();
                    if (["edit", "edited-failure", "restored"].includes(scenario))
                        await page.getByRole("textbox", { name: "Redirect 1", exact: true }).fill("https://example.com/newer");
                    if (scenario === "restored") await page.getByRole("textbox", { name: "Redirect 1", exact: true }).fill("https://example.com/first");
                    if (scenario === "add") {
                        await page.getByRole("button", { name: "Add redirect", exact: true }).click();
                        await page.getByRole("textbox", { name: "Redirect 3", exact: true }).fill("https://example.com/third");
                    }
                    if (["remove", "clear"].includes(scenario)) await page.getByRole("button", { name: "Remove redirect 1", exact: true }).click();
                    if (scenario === "clear") await page.getByRole("button", { name: "Remove redirect 1", exact: true }).click();
                    const draft = await page.evaluate(() => readDraft());
                    await page.evaluate((scenario) => {
                        if (["stale", "superseded", "stale-failure"].includes(scenario)) renderVersion++;
                        if (["stale", "detached", "stale-failure"].includes(scenario)) document.querySelector("#view").replaceChildren(document.createTextNode("Current page"));
                    }, scenario);
                    await page.locator("#outside").focus();
                    await page.evaluate((scenario) => {
                        if (scenario.endsWith("failure"))
                            rejectRedirect(
                                Object.assign(new Error("Synthetic redirect rejection"), {
                                    field: "redirect_uris.0",
                                }),
                            );
                        else releaseRedirect({ redirect_uris: submitted.redirect_uris });
                    }, scenario);
                    await page.waitForFunction(() => !oldSave.disabled);
                    assert.deepEqual(await page.evaluate(() => readDraft()), draft, "The older response must preserve the current redirect draft");
                    if (["stale", "superseded", "detached", "stale-failure"].includes(scenario)) {
                        assert.equal(await page.evaluate(() => updateCalls), 0);
                        assert.equal(await page.evaluate(() => oldCard.querySelector("[role=alert]").hidden), true);
                        assert.equal(await page.evaluate(() => document.activeElement.id), "outside");
                    } else if (scenario.endsWith("failure")) {
                        assert.equal(await page.getByRole("alert").textContent(), "Synthetic redirect rejection");
                        assert.equal(await page.getByRole("textbox", { name: "Redirect 1", exact: true }).getAttribute("aria-invalid"), scenario === "failure" ? "true" : null);
                        assert.equal(await page.evaluate(() => document.activeElement.id), scenario === "failure" ? "redirect-0" : "outside");
                    } else {
                        assert.equal(
                            await page.getByRole("status").textContent(),
                            ["unchanged", "restored"].includes(scenario) ? "Changes saved." : "Changes saved. You have unsaved changes.",
                        );
                        assert.deepEqual(await page.locator("#oauth-redirect option").evaluateAll((options) => options.map((option) => option.value)), [
                            "",
                            "https://example.com/first",
                            "https://example.com/second",
                        ]);
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
