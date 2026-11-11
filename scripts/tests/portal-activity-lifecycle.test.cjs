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
const activities = source.slice(sourceMarker(source, "    const renderActivities ="), sourceMarker(source, "    const DATA_FIELD ="));
for (const browserName of ["chromium", "webkit"]) {
    test(`${browserName} activity mutations keep only their current editor UI`, {
        skip: !playwright || (browserName === "chromium" && !fs.existsSync(executablePath)),
        timeout: 60000,
    }, async () => {
        const browser = await playwright[browserName].launch(browserName === "chromium" ? { executablePath, headless: true } : { headless: true });
        try {
            for (const kind of ["enable", "disable", "settings", "mappings"]) {
                for (const state of ["current", "stale", "detached"]) {
                    for (const fail of [false, true]) {
                        const page = await browser.newPage();
                        try {
                            await page.setContent("<!doctype html><main id=view></main><button id=outside>Outside</button>");
                            await page.addScriptTag({
                                content: `let renderVersion=0;${elements};${messages};const config={activityHost:"localhost"};const FLAGS={embedded:1<<17,embeddedReleased:1<<1};const copyButton=()=>document.createElement("button");const switchRow=(id,label,hint,input)=>input;const flagToggle=()=>document.createElement("input");const confirmDialog=()=>Promise.resolve(true);window.renderCalls=0;const render=async()=>{renderCalls++;};const api=(method,path)=>method==="GET"?Promise.resolve(path.endsWith("proxy-config")?{url_map:[{prefix:"/",target:"fixture.example"}]}:{supported_platforms:["web"]}):new Promise((resolve,reject)=>{window.releaseActivity=resolve;window.rejectActivity=reject;});${activities};window.mountActivities=async flags=>document.querySelector("#view").append(...await renderActivities({id:"111",name:"Fixture",flags}));`,
                            });
                            await page.evaluate((kind) => mountActivities(kind === "enable" ? 0 : 1 << 17), kind);
                            const action =
                                kind === "enable" || kind === "disable"
                                    ? page.getByRole("button", {
                                          name: kind === "enable" ? "Enable activities" : "Disable activities",
                                          exact: true,
                                      })
                                    : page
                                          .locator("form")
                                          .filter({
                                              has: page.getByRole("heading", {
                                                  name: kind === "settings" ? "Activity settings" : "URL mappings",
                                                  exact: true,
                                              }),
                                          })
                                          .getByRole("button", { name: "Save changes", exact: true });
                            await action.evaluate((button) => (window.oldActivityButton = button));
                            await action.click();
                            await page.waitForFunction(() => window.releaseActivity);
                            assert.equal(await page.evaluate(() => oldActivityButton.disabled), true);
                            await page.evaluate((state) => {
                                if (state === "stale") renderVersion++;
                                if (state !== "current")
                                    document
                                        .querySelector("#view")
                                        .replaceChildren(document.createTextNode("Current page"), Object.assign(document.createElement("input"), { id: "mapping-target-0" }));
                            }, state);
                            await page.locator("#outside").focus();
                            await page.evaluate((fail) => {
                                if (fail) {
                                    const error = new Error("Synthetic activity failure");
                                    error.field = "url_map.0.target";
                                    rejectActivity(error);
                                } else
                                    releaseActivity({
                                        id: "111",
                                        flags: 1 << 17,
                                        url_map: [{ prefix: "/", target: "saved.example" }],
                                    });
                            }, fail);
                            await page.waitForFunction(() => !oldActivityButton.disabled);
                            assert.equal(
                                await page.evaluate(() => renderCalls),
                                state === "current" && !fail && (kind === "enable" || kind === "disable") ? 1 : 0,
                                "An obsolete mutation must not refresh the current page",
                            );
                            if (state !== "current") {
                                assert.equal(await page.locator("#view").textContent(), "Current page");
                                assert.equal(await page.locator("#mapping-target-0").getAttribute("aria-invalid"), null);
                                assert.equal(await page.evaluate(() => document.activeElement.id), "outside");
                            } else if (fail) assert.equal(await page.getByRole("alert").filter({ hasText: "Synthetic activity failure" }).count(), 1);
                            else if (kind === "settings" || kind === "mappings") assert.equal(await page.getByRole("status").filter({ hasText: "Changes saved." }).count(), 1);
                        } finally {
                            await page.close();
                        }
                    }
                }
            }
        } finally {
            await browser.close();
        }
    });
}
