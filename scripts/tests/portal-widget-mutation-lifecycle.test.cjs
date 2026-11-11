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
const controls = source.slice(
    sourceMarker(source, "        const publicToggle =", sourceMarker(source, "    const renderWidget =")),
    sourceMarker(source, "        // Values for {{keys}}"),
);
for (const browserName of ["chromium", "webkit"]) {
    test(`${browserName} widget configuration and profile callbacks retain their current editor`, {
        skip: !playwright || (browserName === "chromium" && !fs.existsSync(executablePath)),
        timeout: 60000,
    }, async () => {
        const browser = await playwright[browserName].launch(browserName === "chromium" ? { executablePath, headless: true } : { headless: true });
        try {
            for (const kind of ["configuration", "profile"])
                for (const state of ["current", "stale", "detached"])
                    for (const fail of [false, true]) {
                        const page = await browser.newPage();

                        try {
                            await page.setContent("<!doctype html><main id=view></main><button id=outside>Outside</button>");
                            await page.addScriptTag({
                                content: `let renderVersion=0;const version=renderVersion;${elements};${messages};const app={id:"111"};const saved={public:false};let savedConfig={surfaces:{widget_top:{}}};let widgets=[];const isSaved=()=>true;const onProfile=()=>widgets.length>0;const assets=new Map();const state={top:{},bottom:{items:[],progress:{}},mini:{}};const widgetProblems=()=>[];const widgetSurfaces=()=>({});const switchRow=()=>document.createElement("span");const topCard=document.createElement("section"),bottomCard=document.createElement("section"),miniCard=document.createElement("section");const errorNode=errorLine(),status=statusLine();window.keyDraws=0;const drawKeys=()=>keyDraws++;const api=()=>new Promise((resolve,reject)=>{window.releaseMutation=resolve;window.rejectMutation=reject;});${controls};document.querySelector("#view").append(form,profileCard);window.oldForm=form;window.oldProfile=profileCard;window.oldButton=${kind === "configuration" ? "save" : "profileButton"};`,
                            });
                            await page
                                .getByRole("button", {
                                    name: kind === "configuration" ? "Save widget" : "Add to my profile",
                                    exact: true,
                                })
                                .click();
                            await page.waitForFunction(() => window.releaseMutation);
                            await page.evaluate((state) => {
                                if (state === "stale") renderVersion++;
                                if (state !== "current") document.querySelector("#view").replaceChildren(document.createTextNode("Current page"));
                            }, state);
                            await page.locator("#outside").focus();
                            await page.evaluate((fail) => {
                                if (fail) rejectMutation(new Error("Synthetic widget failure"));
                                else
                                    releaseMutation({
                                        config: { surfaces: { widget_top: {} }, assets: [] },
                                        widgets: [{ data: { type: "application", application_id: "111" } }],
                                    });
                            }, fail);
                            await page.waitForFunction(() => !oldButton.disabled);
                            if (state !== "current") {
                                assert.equal(await page.evaluate(() => keyDraws), 0, "Obsolete configuration saves must not redraw keys");
                                assert.equal(
                                    await page.evaluate(() =>
                                        [...oldForm.querySelectorAll("[role=status],[role=alert]"), ...oldProfile.querySelectorAll("[role=status],[role=alert]")].every(
                                            (node) => node.hidden || !node.textContent,
                                        ),
                                    ),
                                    true,
                                    "Obsolete callbacks must not publish status or errors",
                                );
                                assert.equal(await page.evaluate(() => document.activeElement.id), "outside");
                                assert.equal(await page.locator("#view").textContent(), "Current page");
                            } else if (fail) assert.equal(await page.getByRole("alert").filter({ hasText: "Synthetic widget failure" }).count(), 1);
                            else
                                assert.equal(
                                    await page
                                        .getByRole("status")
                                        .filter({
                                            hasText: kind === "configuration" ? "Widget saved." : "Added to your profile.",
                                        })
                                        .count(),
                                    1,
                                );
                        } finally {
                            await page.close();
                        }
                    }
        } finally {
            await browser.close();
        }
    });
}
