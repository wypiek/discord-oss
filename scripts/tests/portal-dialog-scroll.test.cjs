const { sourceMarker } = require("./helpers/source-marker.cjs");
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
const source = fs.readFileSync("assets/public/developers/portal.js", "utf8");
const factory = source.slice(sourceMarker(source, "    const confirmDialog ="), sourceMarker(source, "    const switchRow ="));
const style = fs.readFileSync("assets/public/developers/portal.css", "utf8");
for (const browserName of ["chromium", "webkit"]) {
    test(`${browserName} portal nested dialogs lock background scrolling until the last dismissal`, {
        skip: !playwright || (browserName === "chromium" && !fs.existsSync(executablePath)),
    }, async () => {
        const browser = await playwright[browserName].launch(browserName === "chromium" ? { executablePath, headless: true } : { headless: true });
        try {
            for (const scenario of ["single", "nested", "existing-lock"]) {
                const page = await browser.newPage();
                try {
                    await page.setContent('<!doctype html><button id="opener">Open</button><div style="height:5000px">Scrollable fixture</div>');
                    await page.addStyleTag({ content: style });
                    await page.addScriptTag({
                        content: `const el=(tag,props,...children)=>{const node=document.createElement(tag);for(const [name,value] of Object.entries(props))node.setAttribute(name,value);node.append(...children);return node;};${factory};window.openFixture=()=>{void confirmDialog({title:"Scroll fixture",body:"Background scroll",action:"Confirm"});};`,
                    });
                    await page.evaluate((scenario) => {
                        scrollTo(0, 400);
                        if (scenario === "existing-lock") document.documentElement.style.setProperty("overflow", "hidden", "important");
                    }, scenario);
                    const before = await page.evaluate(() => scrollY);
                    await page.evaluate(() => openFixture());
                    if (scenario === "nested") await page.evaluate(() => openFixture());
                    assert.equal(await page.locator(":modal").count(), scenario === "nested" ? 2 : 1);
                    await page.mouse.move(4, 4);
                    await page.mouse.wheel(0, 500);
                    await page.waitForTimeout(250);
                    assert.equal(await page.evaluate(() => scrollY), before, `${scenario}: background stays locked`);
                    if (scenario === "nested") {
                        await page.keyboard.press("Escape");
                        assert.equal(await page.locator(":modal").count(), 1);
                        await page.mouse.wheel(0, 500);
                        await page.waitForTimeout(250);
                        assert.equal(await page.evaluate(() => scrollY), before, "Closing the top dialog preserves the parent lock");
                    }
                    await page.keyboard.press("Escape");
                    await page.waitForFunction(() => !document.querySelector(":modal"));
                    assert.equal(await page.evaluate(() => scrollY), before, "Dismissal preserves the original scroll position");
                    if (scenario === "existing-lock") {
                        assert.deepEqual(
                            await page.evaluate(() => [
                                document.documentElement.style.getPropertyValue("overflow"),
                                document.documentElement.style.getPropertyPriority("overflow"),
                            ]),
                            ["hidden", "important"],
                        );
                        await page.mouse.wheel(0, 500);
                        await page.waitForTimeout(250);
                        assert.equal(await page.evaluate(() => scrollY), before, "The pre-existing scroll lock remains active");
                        await page.evaluate(() => document.documentElement.style.removeProperty("overflow"));
                    }
                    await page.mouse.wheel(0, 500);
                    await page.waitForFunction((before) => scrollY > before, before);
                } finally {
                    await page.close();
                }
            }
        } finally {
            await browser.close();
        }
    });
}
