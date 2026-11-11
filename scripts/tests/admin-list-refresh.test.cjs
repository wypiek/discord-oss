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
const listSource = source.slice(source.indexOf("function latestList("), source.indexOf("/* ---------- users ---------- */"));
for (const browserName of ["chromium", "webkit"]) {
    test(`${browserName} admin lists preserve rows while refreshing and retrying failures`, {
        skip: !playwright || (browserName === "chromium" && !fs.existsSync(executablePath)),
        timeout: 30000,
    }, async () => {
        const browser = await playwright[browserName].launch(browserName === "chromium" ? { executablePath, headless: true } : { headless: true });
        try {
            for (const scenario of ["success", "failure-retry", "superseded", "detached", "initial-failure"]) {
                const page = await browser.newPage();
                try {
                    await page.setContent(
                        '<!doctype html><div id="view"><div id="status" role="status" hidden></div><div id="results"><table><tbody><tr id="existing"><td>Previous fixture</td></tr></tbody></table></div></div>',
                    );
                    await page.addScriptTag({
                        content: `const $=(selector,root=document)=>root.querySelector(selector);const mount=(node,content)=>node.innerHTML=content;const html=(strings,...values)=>strings.map((part,index)=>part+(values[index]??"")).join("");const fmtNumber=value=>String(value);window.calls=[];const api=(path,{signal})=>new Promise((resolve,reject)=>calls.push({path,signal,resolve,reject}));${listSource};const view=$("#view"),results=$("#results"),status=$("#status");window.existing=$("#existing");window.renderCount=0;const render=data=>{renderCount++;mount(results,"<table><tbody><tr><td>"+data.total+" fixture results</td></tr></tbody></table>");};const lists=latestList(view,results,status);window.loadFixture=()=>{window.finished=false;void lists.load("fixture",render,loadFixture).then(()=>window.finished=true);};window.lists=lists;`,
                    });
                    if (scenario === "initial-failure") await page.locator("#results").evaluate((results) => (results.innerHTML = '<div class="spinner">Loading</div>'));
                    await page.evaluate(() => loadFixture());
                    assert.equal(await page.locator("#results").getAttribute("aria-busy"), "true");
                    if (scenario !== "initial-failure") assert.equal(await page.evaluate(() => existing === document.querySelector("#existing")), true);
                    if (scenario === "superseded") {
                        await page.evaluate(() => loadFixture());
                        assert.equal(await page.evaluate(() => calls[0].signal.aborted), true);
                        await page.evaluate(() => calls[0].resolve({ total: 99 }));
                        assert.equal(await page.evaluate(() => renderCount), 0);
                        assert.equal(await page.locator("#results").getAttribute("aria-busy"), "true");
                        await page.evaluate(() => calls[1].resolve({ total: 2 }));
                        await page.waitForFunction(() => renderCount === 1);
                    } else if (scenario === "detached") {
                        await page.locator("#view").evaluate((view) => view.remove());
                        await page.evaluate(() => calls[0].resolve({ total: 99 }));
                        await page.waitForFunction(() => finished);
                        assert.equal(await page.evaluate(() => renderCount), 0);
                        continue;
                    } else if (scenario.endsWith("failure") || scenario === "failure-retry") {
                        await page.evaluate(() => calls[0].reject(Object.assign(new Error("Fixture connection failure"), { status: 503 })));
                        await page.waitForFunction(() => finished);
                        assert.equal(await page.locator("#results").getAttribute("aria-busy"), "false");
                        if (scenario === "initial-failure") assert.match(await page.locator("#results").textContent(), /Results couldn't load/);
                        else assert.equal(await page.evaluate(() => existing === document.querySelector("#existing")), true);
                        await page.getByRole("button", { name: "Retry search", exact: true }).click();
                        assert.equal(await page.evaluate(() => calls.length), 2);
                        await page.evaluate(() => calls[1].resolve({ total: 2 }));
                        await page.waitForFunction(() => finished);
                    } else {
                        await page.evaluate(() => calls[0].resolve({ total: 2 }));
                        await page.waitForFunction(() => finished);
                    }
                    assert.equal(await page.locator("#results").getAttribute("aria-busy"), "false");
                    assert.equal(await page.locator("#status").textContent(), "2 results");
                    assert.equal(await page.locator("#results").textContent(), "2 fixture results");
                    assert.equal(await page.evaluate(() => renderCount), 1);
                } finally {
                    await page.close();
                }
            }
        } finally {
            await browser.close();
        }
    });
}
