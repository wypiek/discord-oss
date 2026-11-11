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
const pickerSource = source.slice(
    sourceMarker(source, "        const imagePicker =", sourceMarker(source, "    const renderWidget =")),
    sourceMarker(source, "        const radios =", sourceMarker(source, "    const renderWidget =")),
);
for (const browserName of ["chromium", "webkit"]) {
    test(`${browserName} widget image uploads preserve newer choices and their editor`, {
        skip: !playwright || (browserName === "chromium" && !fs.existsSync(executablePath)),
        timeout: 60000,
    }, async () => {
        const browser = await playwright[browserName].launch(browserName === "chromium" ? { executablePath, headless: true } : { headless: true });
        try {
            for (const stage of ["read", "upload"])
                for (const state of ["current", "stale", "superseded", "detached", "removed", "replaced"])
                    for (const fail of [false, true]) {
                        const page = await browser.newPage();
                        try {
                            await page.setContent("<!doctype html><main id=view></main>");
                            await page.addScriptTag({
                                content: `let renderVersion=0;const version=renderVersion;${elements};${messages};const app={id:"111"};const assets=new Map([["initial",{key:"initial"}]]);const assetUrl=()=>"data:image/png;base64,iVBORw0KGgo=";let selected="initial";window.previewCalls=0;const drawPreview=()=>previewCalls++;const errorNode=errorLine();const syncWidgetDraftStatus=()=>{};window.reads=[];window.uploads=[];const readFile=()=>new Promise((resolve,reject)=>reads.push({resolve,reject}));const api=()=>new Promise((resolve,reject)=>uploads.push({resolve,reject}));${pickerSource};const picker=imagePicker("image","Image",()=>selected,key=>selected=key);document.querySelector("#view").append(picker,errorNode);window.oldPicker=picker;window.oldUpload=picker.querySelector("#image");window.selectedKey=()=>selected;`,
                            });
                            const file = page.locator("input[type=file]");
                            await file.setInputFiles({
                                name: "first.png",
                                mimeType: "image/png",
                                buffer: Buffer.from("first"),
                            });
                            if (stage === "upload") {
                                await page.evaluate(() => reads[0].resolve("first"));
                                await page.waitForFunction(() => uploads.length === 1);
                            }
                            if (state === "removed" || state === "replaced") await page.getByRole("button", { name: "Remove image", exact: true }).click();
                            if (state === "replaced") {
                                await file.setInputFiles({
                                    name: "second.png",
                                    mimeType: "image/png",
                                    buffer: Buffer.from("second"),
                                });
                                await page.evaluate(() => reads[1].resolve("second"));
                                await page.waitForFunction((count) => uploads.length === count, stage === "upload" ? 2 : 1);
                            }
                            await page.evaluate((state) => {
                                if (state === "stale" || state === "superseded") renderVersion++;
                                if (state === "stale" || state === "detached") document.querySelector("#view").replaceChildren(document.createTextNode("Current page"));
                                window.drawsBefore = previewCalls;
                            }, state);
                            await page.evaluate(
                                ({ stage, fail }) => {
                                    const work = stage === "read" ? reads[0] : uploads[0];
                                    if (fail) work.reject(new Error("Synthetic image failure"));
                                    else work.resolve(stage === "read" ? "first" : { key: "first" });
                                },
                                { stage, fail },
                            );
                            if (stage === "read" && state === "current" && !fail) {
                                await page.waitForFunction(() => uploads.length === 1);
                                await page.evaluate(() => uploads[0].resolve({ key: "first" }));
                            }
                            await page.waitForTimeout(30);
                            if (state === "current") {
                                await page.waitForFunction(() => !oldUpload.disabled);
                                assert.equal(await page.evaluate(() => selectedKey()), fail ? "initial" : "first");
                                assert.equal(await page.getByRole("alert").filter({ hasText: "Synthetic image failure" }).count(), fail ? 1 : 0);
                            } else {
                                assert.equal(
                                    await page.evaluate(() => selectedKey()),
                                    state === "removed" || state === "replaced" ? null : "initial",
                                    "A late upload must not restore an obsolete image choice",
                                );
                                assert.equal(await page.evaluate(() => previewCalls), await page.evaluate(() => drawsBefore));
                                assert.equal(await page.evaluate(() => errorNode.hidden), true, "A late failure must not publish an obsolete error");
                                if (stage === "read")
                                    assert.equal(await page.evaluate(() => uploads.length), state === "replaced" ? 1 : 0, "Obsolete file reads must not submit uploads");
                                if (state === "replaced") {
                                    assert.equal(await page.evaluate(() => oldUpload.disabled), true, "The older completion must not enable the newer pending upload");
                                    await page.evaluate(() => uploads.at(-1).resolve({ key: "second" }));
                                    await page.waitForFunction(() => !oldUpload.disabled);
                                    assert.equal(await page.evaluate(() => selectedKey()), "second");
                                }
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
