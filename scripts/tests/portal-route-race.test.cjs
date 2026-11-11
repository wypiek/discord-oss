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
const elementSource = source.slice(sourceMarker(source, "    const el ="), sourceMarker(source, "    const errorText ="));
const listSource = source.slice(sourceMarker(source, "    const renderList ="), sourceMarker(source, "    const renderInformation ="));
const appSource = source.slice(sourceMarker(source, "    const renderApp ="), sourceMarker(source, "\n    render();", sourceMarker(source, "    const renderApp =")));
for (const browserName of ["chromium", "webkit"]) {
    test(`${browserName} portal navigation ignores obsolete read and section results`, {
        skip: !playwright || (browserName === "chromium" && !fs.existsSync(executablePath)),
        timeout: 30000,
    }, async () => {
        const browser = await playwright[browserName].launch(browserName === "chromium" ? { executablePath, headless: true } : { headless: true });
        try {
            for (const scenario of ["list-success", "list-failure", "app-success", "app-failure", "section-success", "section-failure"]) {
                const page = await browser.newPage();
                try {
                    await page.route("http://localhost:3413/**", (route) =>
                        route.fulfill({
                            contentType: "text/html",
                            body: "<!doctype html><title>Fixture</title><main id=view tabindex=-1></main><button id=outside>Outside action</button>",
                        }),
                    );
                    await page.goto("http://localhost:3413/developers/applications");
                    await page.addScriptTag({
                        content: `${elementSource};let renderVersion=0;const config={instanceName:"Fixture"};const view=document.querySelector("#view");const widgetDialog=()=>{};const createDialog=()=>{};const appIcon=()=>document.createElement("span");const navigate=()=>{};const setNav=(app)=>window.navState=app?.id??null;window.reads=[];const api=(method,path)=>new Promise((resolve,reject)=>reads.push({path,resolve,reject}));const SECTIONS={information:["Information",app=>app.id==="111"&&window.sectionDelayed?new Promise((resolve,reject)=>window.oldSection={resolve,reject}):[document.createTextNode(app.name)]]};${listSource};${appSource};window.render=render;`,
                    });
                    await page.evaluate((scenario) => {
                        window.sectionDelayed = scenario.startsWith("section-");
                        history.replaceState(null, "", scenario.startsWith("list-") ? "/developers/applications" : "/developers/applications/111/information");
                        window.oldFinished = false;
                        window.oldRender = render().then(() => (window.oldFinished = true));
                    }, scenario);
                    if (scenario.startsWith("section-")) {
                        await page.evaluate(() => reads[0].resolve({ id: "111", name: "Obsolete application" }));
                        await page.waitForFunction(() => window.oldSection);
                    }
                    await page.evaluate(() => {
                        history.pushState(null, "", "/developers/applications/222/information");
                        window.currentFinished = false;
                        void render().then(() => (window.currentFinished = true));
                    });
                    await page.evaluate(() => reads.at(-1).resolve({ id: "222", name: "Current application" }));
                    await page.waitForFunction(() => currentFinished);
                    await page.locator("#outside").focus();
                    await page.evaluate((scenario) => {
                        const pending = scenario.startsWith("section-") ? oldSection : reads[0];
                        if (scenario.endsWith("failure")) pending.reject(new Error("Obsolete request failure"));
                        else
                            pending.resolve(
                                scenario.startsWith("section-")
                                    ? [document.createTextNode("Obsolete section")]
                                    : scenario.startsWith("list-")
                                      ? []
                                      : { id: "111", name: "Obsolete application" },
                            );
                    }, scenario);
                    await page.waitForFunction(() => oldFinished);
                    assert.match(await page.locator("#view").innerText(), /Current application/);
                    assert.equal(await page.evaluate(() => navState), "222");
                    assert.match(await page.title(), /Current application/);
                    assert.equal(await page.evaluate(() => document.activeElement.id), "outside", "An obsolete render must not steal focus");
                } finally {
                    await page.close();
                }
            }
        } finally {
            await browser.close();
        }
    });
}
