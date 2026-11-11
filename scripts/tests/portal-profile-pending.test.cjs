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
    test(`${browserName} configuration completion cannot enable a pending profile mutation`, {
        skip: !playwright || (browserName === "chromium" && !fs.existsSync(executablePath)),
        timeout: 60000,
    }, async () => {
        const browser = await playwright[browserName].launch(browserName === "chromium" ? { executablePath, headless: true } : { headless: true });
        try {
            for (const removing of [false, true])
                for (const configurationFailure of [false, true])
                    for (const profileFailure of [false, true]) {
                        const page = await browser.newPage();
                        try {
                            await page.setContent("<!doctype html><main id=view></main>");
                            await page.addScriptTag({
                                content: `let renderVersion=0;const version=renderVersion;${elements};${messages};const app={id:"111"};const saved={public:false};let savedConfig={surfaces:{widget_top:{}}};let widgets=${removing ? '[{data:{type:"application",application_id:"111"}}]' : "[]"};const isSaved=()=>true;const onProfile=()=>widgets.some(widget=>widget.data.application_id===app.id);const assets=new Map();const state={top:{},bottom:{items:[],progress:{}},mini:{}};const widgetProblems=()=>[];const widgetSurfaces=()=>({});const switchRow=()=>document.createElement("span");const topCard=document.createElement("section"),bottomCard=document.createElement("section"),miniCard=document.createElement("section");const errorNode=errorLine(),status=statusLine();const drawKeys=()=>{};window.profileWrites=0;window.calls={};const api=(method,path,body)=>{const kind=path === "/users/@me/widgets" ? "profile":"configuration";if(kind === "profile")profileWrites++;return new Promise((resolve,reject)=>calls[kind]={resolve,reject,body});};${controls};document.querySelector("#view").append(form,profileCard);window.profileAction=profileButton;window.saveAction=save;`,
                            });
                            await page
                                .getByRole("button", {
                                    name: removing ? "Remove from my profile" : "Add to my profile",
                                    exact: true,
                                })
                                .click();
                            await page.getByRole("button", { name: "Save widget", exact: true }).click();
                            await page.evaluate((fail) => {
                                if (fail) calls.configuration.reject(new Error("Configuration failure"));
                                else
                                    calls.configuration.resolve({
                                        config: { surfaces: { widget_top: {} }, assets: [] },
                                    });
                            }, configurationFailure);
                            await page.waitForFunction(() => !saveAction.disabled);
                            assert.equal(await page.evaluate(() => profileAction.disabled), true, "Configuration completion must retain the pending profile lock");
                            await page.evaluate(() => {
                                profileAction.dispatchEvent(new MouseEvent("click"));
                                profileAction.dispatchEvent(new MouseEvent("click"));
                            });
                            assert.equal(await page.evaluate(() => profileWrites), 1, "Repeated activation must submit only the original profile write");
                            await page.evaluate((fail) => {
                                if (fail) calls.profile.reject(new Error("Profile failure"));
                                else calls.profile.resolve({ widgets: calls.profile.body.widgets });
                            }, profileFailure);
                            await page.waitForFunction(() => !profileAction.disabled);
                            assert.equal(await page.evaluate(() => profileAction.textContent), removing !== profileFailure ? "Add to my profile" : "Remove from my profile");
                            if (profileFailure) assert.equal(await page.getByRole("alert").filter({ hasText: "Profile failure" }).count(), 1);
                            else
                                assert.equal(
                                    await page
                                        .getByRole("status")
                                        .filter({
                                            hasText: removing ? "Removed from your profile." : "Added to your profile.",
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
