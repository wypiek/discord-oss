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
    test(`${browserName} widget saves retain newer configuration drafts`, {
        skip: !playwright || (browserName === "chromium" && !fs.existsSync(executablePath)),
        timeout: 60000,
    }, async () => {
        const browser = await playwright[browserName].launch(browserName === "chromium" ? { executablePath, headless: true } : { headless: true });
        try {
            for (const scenario of ["unchanged", "title", "public", "layout", "image", "remove-image", "restored", "failure", "late-image", "restored-status"]) {
                const page = await browser.newPage();
                try {
                    await page.setContent("<!doctype html><main id=view></main>");
                    await page.addScriptTag({
                        content: `let renderVersion=0;const version=renderVersion;${elements};${messages};const app={id:"111"};const saved={public:false};let savedConfig={surfaces:{widget_top:{}}};let widgets=[];const isSaved=()=>true;const onProfile=()=>false;const assets=new Map([["initial",{key:"initial"}],["hidden",{key:"hidden"}]]);const state={top:{title:"submitted",image:"initial"},bottom:{layout:"stats",items:[{image:"hidden"}],progress:{}},mini:{}};const widgetProblems=()=>[];const widgetSurfaces=()=>({title:state.top.title,image:state.top.image,layout:state.bottom.layout});const switchRow=()=>document.createElement("span");const topCard=document.createElement("section"),bottomCard=document.createElement("section"),miniCard=document.createElement("section");const errorNode=errorLine(),status=statusLine();const drawKeys=()=>{};const api=(method,path,body)=>{window.submitted=JSON.parse(JSON.stringify(body));return new Promise((resolve,reject)=>{window.releaseSave=resolve;window.rejectSave=reject;});};${controls};document.querySelector("#view").append(form,profileCard);window.oldSave=save;window.changeDraft=scenario=>{if(scenario === "title" || scenario === "failure") state.top.title="newer";if(scenario === "public") publicToggle.checked=true;if(scenario === "layout") state.bottom.layout="collection";if(scenario === "image"){state.top.image="newer-image";assets.set("newer-image",{key:"newer-image"});}if(scenario === "remove-image")state.top.image=null;if(scenario === "restored"){state.top.title="newer";state.top.title="submitted";}};window.currentDraft=()=>widgetDraft();`,
                    });
                    await page.getByRole("button", { name: "Save widget", exact: true }).click();
                    assert.deepEqual(await page.evaluate(() => submitted.asset_keys), ["initial", "hidden"]);
                    assert.deepEqual(await page.evaluate(() => submitted.retained_asset_keys), ["initial", "hidden"]);
                    await page.evaluate((scenario) => changeDraft(scenario), scenario);
                    const draft = await page.evaluate(() => currentDraft());
                    await page.evaluate((scenario) => {
                        if (scenario === "failure") rejectSave(new Error("Synthetic configuration failure"));
                        else
                            releaseSave({
                                config: {
                                    surfaces: { widget_top: {} },
                                    assets: [{ key: "initial" }, { key: "hidden" }, { key: "newer-image" }],
                                },
                            });
                    }, scenario);
                    await page.waitForFunction(() => !oldSave.disabled);
                    assert.equal(await page.evaluate(() => currentDraft()), draft);
                    if (scenario === "restored-status") {
                        await page.evaluate(() => {
                            state.top.title = "newer";
                            syncWidgetDraftStatus();
                        });
                        assert.equal(await page.locator(".wp-save [role=status]").textContent(), "You have unsaved changes.");
                        await page.evaluate(() => {
                            state.top.title = "submitted";
                            syncWidgetDraftStatus();
                        });
                        assert.equal(await page.locator(".wp-save [role=status]").textContent(), "");
                        continue;
                    }
                    if (scenario === "late-image") {
                        await page.evaluate(() => {
                            state.top.image = "late-image";
                            syncWidgetDraftStatus();
                        });
                        assert.equal(await page.locator(".wp-save [role=status]").textContent(), "You have unsaved changes.");
                        continue;
                    }
                    if (scenario === "failure") assert.equal(await page.getByRole("alert").textContent(), "Synthetic configuration failure");
                    else
                        assert.equal(
                            await page.locator(".wp-save [role=status]").textContent(),
                            ["unchanged", "restored"].includes(scenario) ? "Widget saved. Add it to your profile below." : "Widget saved. You have unsaved changes.",
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
