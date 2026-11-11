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
    test(`${browserName} information saves retain newer drafts`, {
        skip: !playwright || (browserName === "chromium" && !fs.existsSync(executablePath)),
        timeout: 30000,
    }, async () => {
        const browser = await playwright[browserName].launch(browserName === "chromium" ? { executablePath, headless: true } : { headless: true });
        try {
            for (const scenario of ["unchanged", "tag-input", "tag-add", "tag-remove", "tag-clear", "name", "description", "endpoint", "terms", "privacy", "icon", "failure"]) {
                const page = await browser.newPage();
                try {
                    await page.setContent("<!doctype html><main id=view></main>");
                    await page.addScriptTag({
                        content: `let renderVersion=0;${elements};${messages};const appIcon=()=>document.createElement("span");const copyField=()=>document.createElement("div");const switchRow=(id,label,hint,input)=>input;const confirmDialog=()=>Promise.resolve(false);const navigate=()=>{};const setNav=()=>{};const readFile=async(file)=>file.name;window.requests=[];const api=(method,path,body)=>{requests.push(JSON.parse(JSON.stringify(body)));return new Promise((resolve,reject)=>{window.releaseSave=resolve;window.rejectSave=reject;});};${information};const app={id:"111",name:"Fixture application",tags:["base"],description:"initial"};document.querySelector("#view").append(...renderInformation(app));window.editor=document.querySelector("form");window.submit=editor.querySelector("button[type=submit]");`,
                    });
                    await page.locator("#app-tags").fill("submitted");
                    if (scenario === "icon")
                        await page.locator('input[type="file"]').setInputFiles({
                            name: "initial.png",
                            mimeType: "image/png",
                            buffer: Buffer.from("fixture"),
                        });
                    await page.getByRole("button", { name: "Save changes", exact: true }).click();
                    assert.equal(await page.evaluate(() => submit.disabled), true);
                    assert.deepEqual(await page.evaluate(() => requests[0].tags), ["base", "submitted"]);
                    if (scenario === "tag-input" || scenario === "failure") await page.locator("#app-tags").fill("new draft");
                    if (scenario === "tag-add") {
                        await page.locator("#app-tags").press("Enter");
                        await page.locator("#app-tags").fill("new-tag");
                        await page.locator("#app-tags").press("Enter");
                    }
                    if (scenario === "tag-remove") await page.getByRole("button", { name: "Remove base", exact: true }).click();
                    if (scenario === "tag-clear") {
                        await page.getByRole("button", { name: "Remove base", exact: true }).click();
                        await page.locator("#app-tags").fill("");
                    }
                    if (scenario === "name") await page.locator("#app-name").fill("New application draft");
                    if (scenario === "description") await page.locator("#app-description").fill("new description");
                    if (["endpoint", "terms", "privacy"].includes(scenario)) await page.locator(`#app-${scenario}`).fill(`https://example.com/${scenario}`);
                    if (scenario === "icon")
                        await page.locator('input[type="file"]').setInputFiles({
                            name: "new.png",
                            mimeType: "image/png",
                            buffer: Buffer.from("fixture"),
                        });
                    const tagsBefore = await page.locator(".tag-list").textContent();
                    const inputBefore = await page.locator("#app-tags").inputValue();
                    await page.evaluate((scenario) => {
                        if (scenario === "failure") rejectSave(new Error("Synthetic information save failure"));
                        else
                            releaseSave({
                                id: "111",
                                name: "Fixture application",
                                tags: ["base", "submitted"],
                                description: "initial",
                            });
                    }, scenario);
                    await page.waitForFunction(() => !submit.disabled);
                    if (scenario === "unchanged") {
                        assert.equal(await page.locator("#app-tags").inputValue(), "");
                        assert.equal(await page.getByRole("status").textContent(), "Changes saved.");
                    } else {
                        assert.equal(await page.locator(".tag-list").textContent(), tagsBefore, "Newer tag drafts must survive the older response");
                        assert.equal(await page.locator("#app-tags").inputValue(), inputBefore, "Pending tag input must survive the older response");
                        if (scenario === "failure") assert.equal(await page.getByRole("alert").filter({ hasText: "Synthetic information save failure" }).count(), 1);
                        else assert.equal(await page.getByRole("status").textContent(), "Changes saved. You have unsaved changes.");
                    }
                    await page.getByRole("button", { name: "Save changes", exact: true }).click();
                    const next = await page.evaluate(() => requests[1]);
                    if (scenario === "tag-input" || scenario === "failure") assert.deepEqual(next.tags, ["base", "new draft"]);
                    if (scenario === "tag-add") assert.deepEqual(next.tags, ["base", "submitted", "new-tag"]);
                    if (scenario === "tag-remove") assert.deepEqual(next.tags, ["submitted"]);
                    if (scenario === "tag-clear") assert.deepEqual(next.tags, []);
                    if (scenario === "name") assert.equal(next.name, "New application draft");
                    if (scenario === "description") assert.equal(next.description, "new description");
                    if (scenario === "endpoint") assert.equal(next.interactions_endpoint_url, "https://example.com/endpoint");
                    if (scenario === "terms") assert.equal(next.terms_of_service_url, "https://example.com/terms");
                    if (scenario === "privacy") assert.equal(next.privacy_policy_url, "https://example.com/privacy");
                    if (scenario === "icon") assert.equal(next.icon, "new.png", "A newer uploaded icon must be submitted on the next save");
                    await page.evaluate(() => releaseSave({ id: "111", name: "Fixture application", tags: requests[1].tags }));
                    await page.waitForFunction(() => !submit.disabled);
                } finally {
                    await page.close();
                }
            }
        } finally {
            await browser.close();
        }
    });
}
