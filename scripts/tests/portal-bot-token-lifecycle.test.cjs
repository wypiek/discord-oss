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
const bot = source.slice(sourceMarker(source, "    const renderBot ="), sourceMarker(source, "    const permissionPicker ="));
const helper = source.slice(sourceMarker(source, "    const showPendingBotToken ="), sourceMarker(source, "    const showPendingClientSecret ="));
for (const browserName of ["chromium", "webkit"]) {
    test(`${browserName} bot tokens remain scoped to their application and current render`, {
        skip: !playwright || (browserName === "chromium" && !fs.existsSync(executablePath)),
        timeout: 30000,
    }, async () => {
        const browser = await playwright[browserName].launch(browserName === "chromium" ? { executablePath, headless: true } : { headless: true });
        try {
            for (const scenario of ["create-current", "create-stale", "create-failure", "reset-current", "reset-stale", "reset-failure"]) {
                const page = await browser.newPage();
                try {
                    await page.setContent("<!doctype html><main id=view></main><button id=outside>Outside</button>");
                    await page.addScriptTag({
                        content: `let renderVersion=0;const pendingTokens=new Map();const pendingBotTokenResets=new Set();let currentBotToken=null;${helper};${elements};${messages};const INTENTS=[];const avatarUrl=()=>null;const appIcon=()=>document.createElement("span");const switchRow=(id,label,hint,input)=>input;const copyButton=()=>document.createElement("button");const confirmDialog=()=>Promise.resolve(true);window.renderCalls=0;const render=async()=>{renderCalls++;const target=window.currentApp??window.app;if(target.bot){document.querySelector("#view").replaceChildren(...renderBot(target));}};const api=()=>new Promise((resolve,reject)=>{window.releaseBot=resolve;window.rejectBot=reject;});${bot};window.makeBot=(app)=>document.querySelector("#view").replaceChildren(...renderBot(app));window.app={id:"111",name:"Fixture",flags:0};`,
                    });
                    if (scenario.startsWith("reset-")) await page.evaluate(() => (app.bot = { username: "Fixture bot" }));
                    await page.evaluate(() => makeBot(app));
                    const action = page.getByRole("button", {
                        name: scenario.startsWith("create-") ? "Add bot" : "Reset token",
                        exact: true,
                    });
                    await action.evaluate((button) => (window.oldAction = button));
                    await action.click();
                    await page.waitForFunction(() => window.releaseBot);
                    if (scenario.endsWith("stale"))
                        await page.evaluate(() => {
                            renderVersion++;
                            window.currentApp = {
                                id: "222",
                                name: "Other application",
                                flags: 0,
                                bot: { username: "Other bot" },
                            };
                            makeBot(currentApp);
                        });
                    await page.locator("#outside").focus();
                    await page.evaluate((scenario) => {
                        if (scenario.endsWith("failure")) rejectBot(new Error("Synthetic bot failure"));
                        else {
                            app.bot = { username: "Fixture bot" };
                            releaseBot({ token: "synthetic-token-A" });
                        }
                    }, scenario);
                    await page.waitForFunction(
                        (scenario) =>
                            scenario.startsWith("create-")
                                ? scenario.endsWith("failure")
                                    ? !oldAction.disabled
                                    : !!document.querySelector("#bot-token") || pendingTokens.has("111")
                                : scenario.endsWith("failure")
                                  ? [...document.querySelectorAll("[role=alert]")].some((node) => !node.hidden)
                                  : scenario.endsWith("stale")
                                    ? pendingTokens.has("111")
                                    : !!document.querySelector("#bot-token"),
                        scenario,
                    );
                    if (scenario.endsWith("stale")) {
                        assert.equal(await page.locator("#bot-token").count(), 0, "An unrelated application must not display the token");
                        assert.equal(await page.evaluate(() => renderCalls), 0, "An obsolete creation must not refresh the current route");
                        await page.evaluate(() => makeBot(app));
                        await page.waitForFunction(() => document.querySelector("#bot-token"));
                        assert.equal(await page.locator("#bot-token").inputValue(), "synthetic-token-A");
                        await page.evaluate(() => makeBot(app));
                        assert.equal(await page.locator("#bot-token").count(), 0, "The token is consumed after its own application displays it");
                    } else if (scenario.endsWith("failure")) {
                        assert.equal(await page.locator("#bot-token").count(), 0);
                        assert.equal(await page.evaluate(() => renderCalls), 0);
                    } else {
                        assert.equal(await page.locator("#bot-token").inputValue(), "synthetic-token-A");
                        assert.equal(await page.evaluate(() => renderCalls), scenario.startsWith("create-") ? 1 : 0);
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
