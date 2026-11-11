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
const information = source.slice(sourceMarker(source, "    const renderInformation ="), sourceMarker(source, "    const renderBot ="));
for (const browserName of ["chromium", "webkit"]) {
    test(`${browserName} application saves retain only their current editor UI`, {
        skip: !playwright || (browserName === "chromium" && !fs.existsSync(executablePath)),
        timeout: 30000,
    }, async () => {
        const browser = await playwright[browserName].launch(browserName === "chromium" ? { executablePath, headless: true } : { headless: true });
        try {
            for (const scenario of ["current-success", "current-failure", "stale-success", "stale-failure", "detached-success", "detached-failure"]) {
                const page = await browser.newPage();
                try {
                    await page.setContent("<!doctype html><main id=view></main><button id=outside>Outside</button>");
                    await page.addScriptTag({
                        content: `let renderVersion=0;${elements};${messages};const appIcon=()=>document.createElement("span");const copyField=()=>document.createElement("div");const switchRow=(id,label,hint,input)=>input;const confirmDialog=()=>Promise.resolve(false);const navigate=()=>{};window.navUpdates=[];const setNav=(app,section)=>navUpdates.push({id:app.id,section});const api=()=>new Promise((resolve,reject)=>{window.releaseSave=resolve;window.rejectSave=reject;});${information};const app={id:"111",name:"Fixture application",tags:[]};document.querySelector("#view").append(...renderInformation(app));window.editor=document.querySelector("form");window.submit=editor.querySelector("button[type=submit]");`,
                    });
                    await page.locator("#app-tags").fill("submitted-tag");
                    await page.getByRole("button", { name: "Save changes", exact: true }).click();
                    assert.equal(await page.evaluate(() => submit.disabled), true);
                    await page.evaluate((scenario) => {
                        if (scenario.startsWith("stale-")) renderVersion++;
                        if (!scenario.startsWith("current-")) document.querySelector("#view").replaceChildren(document.createTextNode("Current page"));
                    }, scenario);
                    await page.locator("#outside").focus();
                    await page.evaluate((scenario) => {
                        if (scenario.endsWith("failure")) rejectSave(new Error("Endpoint validation failed"));
                        else releaseSave({ id: "111", name: "Saved application", tags: ["submitted-tag"] });
                    }, scenario);
                    await page.waitForFunction(() => !submit.disabled);
                    if (scenario === "current-success") {
                        assert.equal(await page.evaluate(() => navUpdates.length), 1);
                        assert.equal(await page.locator("#app-tags").inputValue(), "");
                        assert.equal(await page.getByRole("status").textContent(), "Changes saved.");
                    } else if (scenario === "current-failure") {
                        assert.equal(await page.evaluate(() => document.activeElement.id), "app-endpoint");
                        assert.equal(await page.locator("#app-endpoint").getAttribute("aria-invalid"), "true");
                    } else {
                        assert.equal(await page.evaluate(() => navUpdates.length), 0, "An obsolete save must not change current navigation");
                        assert.equal(await page.evaluate(() => editor.querySelector("#app-tags").value), "submitted-tag");
                        assert.equal(await page.evaluate(() => editor.querySelector("#app-endpoint").getAttribute("aria-invalid")), null);
                        assert.equal(await page.evaluate(() => editor.querySelector('[role="status"]').textContent), "");
                        assert.equal(await page.locator("#view").textContent(), "Current page");
                        assert.equal(await page.evaluate(() => document.activeElement.id), "outside");
                    }
                } finally {
                    await page.close();
                }
            }
            for (const scenario of ["current-success", "current-failure", "stale-success", "stale-failure", "detached-success", "detached-failure", "stale-confirmation"]) {
                const page = await browser.newPage();
                try {
                    await page.setContent("<!doctype html><main id=view></main><button id=outside>Outside</button>");
                    await page.addScriptTag({
                        content: `let renderVersion=0;${elements};${messages};const appIcon=()=>document.createElement("span");const copyField=()=>document.createElement("div");const switchRow=(id,label,hint,input)=>input;window.deleteCalls=0;window.routes=[];const navigate=path=>routes.push(path);const setNav=()=>{};const confirmDialog=()=>new Promise(resolve=>window.releaseDecision=resolve);const api=()=>{deleteCalls++;return new Promise((resolve,reject)=>{window.releaseDelete=resolve;window.rejectDelete=reject;});};${information};document.querySelector("#view").append(...renderInformation({id:"111",name:"Fixture application",tags:[]}));`,
                    });
                    const action = page.getByRole("button", { name: "Delete application", exact: true });
                    await action.evaluate((button) => (window.deleteButton = button));
                    await action.click();
                    await page.waitForFunction(() => window.releaseDecision);
                    if (scenario === "stale-confirmation")
                        await page.evaluate(() => {
                            renderVersion++;
                            document.querySelector("#view").replaceChildren(document.createTextNode("Current page"));
                        });
                    await page.evaluate(async () => {
                        releaseDecision(true);
                        await new Promise((resolve) => setTimeout(resolve, 0));
                    });
                    if (scenario === "stale-confirmation") {
                        assert.equal(await page.evaluate(() => deleteCalls), 0, "An obsolete confirmation must not submit deletion");
                        continue;
                    }
                    await page.waitForFunction(() => window.releaseDelete);
                    assert.equal(await page.evaluate(() => deleteButton.disabled), true, "Pending deletion disables its opener");
                    await page.evaluate((scenario) => {
                        if (scenario.startsWith("stale-")) renderVersion++;
                        if (!scenario.startsWith("current-")) document.querySelector("#view").replaceChildren(document.createTextNode("Current page"));
                    }, scenario);
                    await page.locator("#outside").focus();
                    await page.evaluate((scenario) => {
                        if (scenario.endsWith("failure")) rejectDelete(new Error("Synthetic deletion failure"));
                        else releaseDelete({});
                    }, scenario);
                    await page.waitForFunction(() => !deleteButton.disabled);
                    assert.deepEqual(await page.evaluate(() => routes), scenario === "current-success" ? ["/developers/applications"] : []);
                    if (scenario === "current-failure") assert.equal(await page.getByRole("alert").filter({ hasText: "Synthetic deletion failure" }).count(), 1);
                    else if (scenario !== "current-success") {
                        assert.equal(await page.locator("#view").textContent(), "Current page");
                        assert.equal(await page.evaluate(() => document.activeElement.id), "outside");
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
