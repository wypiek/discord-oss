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
const profileSource = source.slice(
    sourceMarker(source, "        const username =", sourceMarker(source, "    const renderBot =")),
    sourceMarker(source, "        const reset =", sourceMarker(source, "    const renderBot =")),
);
for (const browserName of ["chromium", "webkit"]) {
    test(`${browserName} bot profile saves preserve pending drafts and current editors`, {
        skip: !playwright || (browserName === "chromium" && !fs.existsSync(executablePath)),
        timeout: 60000,
    }, async () => {
        const browser = await playwright[browserName].launch(browserName === "chromium" ? { executablePath, headless: true } : { headless: true });
        try {
            for (const scenario of ["unchanged", "username", "avatar", "failure", "stale", "detached", "duplicate", "read-order"]) {
                const page = await browser.newPage();
                try {
                    await page.setContent("<!doctype html><main id=view></main><button id=outside>Outside</button>");
                    await page.addScriptTag({
                        content: `let renderVersion=0;const version=renderVersion;const app={id:"111",bot:{username:"Initial"}};${elements};${messages};const avatarUrl=()=>null;const appIcon=()=>document.createElement("span");window.reads=[];const readFile=()=>new Promise(resolve=>reads.push(resolve));window.requests=[];const api=(method,path,body)=>{requests.push(body);return new Promise((resolve,reject)=>{window.finish=resolve;window.fail=reject;});};${profileSource};document.querySelector("#view").append(profile);window.oldProfile=profile;window.selectImage=()=>{Object.defineProperty(fileInput,"files",{configurable:true,value:[{}]});fileInput.dispatchEvent(new Event("change"));};`,
                    });
                    await page.evaluate(() => {
                        selectImage();
                        reads[0]("data:image/png;base64,first");
                    });
                    await page.waitForFunction(() => document.querySelector("form img")?.getAttribute("src") === "data:image/png;base64,first");
                    if (scenario === "read-order") {
                        await page.evaluate(() => {
                            selectImage();
                            selectImage();
                            reads[2]("data:image/png;base64,newest");
                        });
                        await page.waitForFunction(() => document.querySelector("form img")?.getAttribute("src") === "data:image/png;base64,newest");
                        await page.evaluate(() => reads[1]("data:image/png;base64,older"));
                        await page.waitForTimeout(30);
                        assert.equal(await page.locator("form img").getAttribute("src"), "data:image/png;base64,newest");
                        continue;
                    }
                    await page.locator("#bot-username").fill("Submitted");
                    await page.getByRole("button", { name: "Save changes", exact: true }).click();
                    await page.waitForFunction(() => requests.length === 1);
                    if (scenario === "duplicate") await page.evaluate(() => oldProfile.dispatchEvent(new Event("submit", { cancelable: true })));
                    assert.equal(await page.evaluate(() => requests.length), 1);
                    if (scenario === "username") await page.locator("#bot-username").fill("New draft");
                    if (scenario === "avatar") {
                        await page.evaluate(() => {
                            selectImage();
                            reads[1]("data:image/png;base64,newer");
                        });
                        await page.waitForFunction(() => document.querySelector("form img")?.getAttribute("src") === "data:image/png;base64,newer");
                    }
                    if (scenario === "stale") await page.evaluate(() => renderVersion++);
                    if (scenario === "detached") await page.evaluate(() => oldProfile.remove());
                    const priorStatus = await page.evaluate(() => oldProfile.querySelector("[role=status]").textContent);
                    await page.locator("#outside").focus();
                    await page.evaluate((scenario) => (scenario === "failure" ? fail(new Error("Synthetic profile failure")) : finish({ username: "Submitted" })), scenario);
                    await page.waitForFunction(() => !oldProfile.querySelector("button[type=submit]").disabled);
                    if (["stale", "detached"].includes(scenario)) assert.equal(await page.evaluate(() => oldProfile.querySelector("[role=status]").textContent), priorStatus);
                    else if (scenario === "username" || scenario === "avatar") {
                        assert.equal(await page.getByRole("status").textContent(), "You have unsaved changes.");
                        await page.getByRole("button", { name: "Save changes", exact: true }).click();
                        await page.waitForFunction(() => requests.length === 2);
                        assert.equal(await page.evaluate(() => requests[1].username), scenario === "username" ? "New draft" : "Submitted");
                        if (scenario === "avatar") assert.equal(await page.evaluate(() => requests[1].avatar), "data:image/png;base64,newer");
                    } else if (scenario === "failure") assert.equal(await page.getByRole("alert").textContent(), "Synthetic profile failure");
                    else assert.equal(await page.getByRole("status").textContent(), "Changes saved.");
                } finally {
                    await page.close();
                }
            }
        } finally {
            await browser.close();
        }
    });
}
