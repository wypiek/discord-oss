const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { homedir } = require("node:os");
const { createRequire } = require("node:module");
const { chromiumPath } = require("../util/chromium.cjs");
let playwright;
try {
    playwright = createRequire(path.join(homedir(), ".cache/fosscord-tools/package.json"))("playwright-core");
} catch {}
const executablePath = chromiumPath();
const source = fs.readFileSync("assets/public/admin/admin.js", "utf8");
const actionSource = source.slice(source.indexOf("const formEditVersions ="), source.indexOf("/* ---------- constants ---------- */"));
const dirtySource = source.slice(source.indexOf("function markFormDirty("), source.indexOf('window.addEventListener("beforeunload"'));
for (const browserName of ["chromium", "webkit"]) {
    test(`${browserName} admin saves retain edits made while requests are pending`, {
        skip: !playwright || (browserName === "chromium" && !fs.existsSync(executablePath)),
        timeout: 30000,
    }, async () => {
        const browser = await playwright[browserName].launch(browserName === "chromium" ? { executablePath, headless: true } : { headless: true });
        try {
            for (const scenario of ["unchanged", "input", "change", "duplicate-change", "checkbox", "multi-select", "files", "other-form", "failure", "detached"]) {
                const page = await browser.newPage();
                try {
                    await page.setContent(
                        '<!doctype html><form id="editor"><input name="fixture"><input name="choice" type="checkbox"><input name="file" type="file"><select name="choices" multiple><option value="first" selected>First</option><option value="second">Second</option></select><button type="button">Save</button></form><form id="other"><input name="fixture"></form><form id="login-form"><input name="login"></form>',
                    );
                    await page.addScriptTag({
                        content: `const toast=()=>{};${actionSource};${dirtySource};window.beginSave=()=>{window.actionResult=undefined;const pending=new Promise((resolve,reject)=>{window.release=resolve;window.reject=reject;});window.editor=document.querySelector("#editor");window.saveButton=editor.querySelector("button");void act(saveButton,()=>pending,"Saved").then(value=>{window.actionResult=value;window.actionFinished=true;});};`,
                    });
                    await page.locator("#editor input[name=fixture]").fill("First fixture");
                    assert.equal(await page.locator("#editor").evaluate((form) => form.dataset.dirty), "true");
                    await page.locator("#editor select").dispatchEvent("input");
                    await page.evaluate(() => beginSave());
                    assert.equal(await page.locator("#editor button").isDisabled(), true);
                    if (scenario === "input") await page.locator("#editor input[name=fixture]").fill("Later fixture");
                    if (scenario === "change")
                        await page.locator("#editor input[name=fixture]").evaluate((input) => {
                            input.value = "Changed fixture";
                            input.dispatchEvent(new Event("change", { bubbles: true }));
                        });
                    if (scenario === "duplicate-change")
                        await page.locator("#editor input[name=fixture]").evaluate((input) => input.dispatchEvent(new Event("change", { bubbles: true })));
                    if (scenario === "checkbox") await page.locator("#editor input[name=choice]").check();
                    if (scenario === "multi-select")
                        await page.locator("#editor select").evaluate((select) => {
                            select.options[1].selected = true;
                            select.dispatchEvent(new Event("change", { bubbles: true }));
                        });
                    if (scenario === "files")
                        await page.locator("#editor input[name=file]").setInputFiles({
                            name: "fixture.txt",
                            mimeType: "text/plain",
                            buffer: Buffer.from("Fixture"),
                        });
                    if (scenario === "other-form") await page.locator("#other input").fill("Other fixture");
                    if (scenario === "detached") await page.locator("#editor").evaluate((form) => form.remove());
                    await page.evaluate((scenario) => (scenario === "failure" ? reject(new Error("Fixture failure")) : release({ saved: true })), scenario);
                    await page.waitForFunction(() => actionFinished);
                    assert.equal(await page.evaluate(() => saveButton.disabled), false);
                    assert.equal(await page.evaluate(() => Boolean(editor.dataset.dirty)), ["input", "change", "checkbox", "multi-select", "files", "failure"].includes(scenario));
                    assert.equal(await page.evaluate(() => actionResult?.saved === true), scenario !== "failure");
                    await page.locator("#login-form input").fill("Fixture login");
                    assert.equal(await page.locator("#login-form").evaluate((form) => form.dataset.dirty), undefined);
                } finally {
                    await page.close();
                }
            }
        } finally {
            await browser.close();
        }
    });
}
