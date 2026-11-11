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
const scrollSource = fs.readFileSync("assets/client_patches/66-native-dialog-scroll.js", "utf8");
const authSource = fs.readFileSync("assets/client_patches/60-auth-pages.js", "utf8");
const uiSource = fs.readFileSync("client/e2ee/src/ui.ts", "utf8");
const dialogStyle = uiSource.slice(uiSource.indexOf("const css = `") + "const css = `".length, uiSource.indexOf("\n`;", uiSource.indexOf("const css = `")));
const typescript = require("typescript");
const dialogSource = typescript.transpileModule(uiSource.slice(sourceMarker(uiSource, "    const dialog ="), sourceMarker(uiSource, "    const field =")), {
    compilerOptions: { target: typescript.ScriptTarget.ES2022 },
}).outputText;
for (const browserName of ["chromium", "webkit"]) {
    for (const kind of ["authentication", "encryption"]) {
        test(`${browserName} ${kind} modal scrolling retains nested and existing locks`, {
            skip: !playwright || (browserName === "chromium" && !fs.existsSync(executablePath)),
            timeout: 30000,
        }, async () => {
            const browser = await playwright[browserName].launch(browserName === "chromium" ? { executablePath, headless: true } : { headless: true });
            try {
                for (const scenario of kind === "authentication"
                    ? ["single", "nested", "existing-lock", "locked"]
                    : ["single", "nested", "existing-lock", "locked", "scrollable-body"]) {
                    const page = await browser.newPage();
                    try {
                        const origin = "http://localhost:3413";
                        await page.route(`${origin}/verify?token=synthetic-scroll-fixture`, (route) =>
                            route.fulfill({
                                contentType: "text/html",
                                body: '<!doctype html><title>Fixture</title><button id="opener" style="position:fixed;top:0">Open</button><div style="height:5000px">Scrollable fixture</div>',
                            }),
                        );
                        await page.route(`${origin}/api/v9/auth/verify`, (route) =>
                            route.fulfill({
                                status: 400,
                                contentType: "application/json",
                                body: '{"message":"Fixture failure"}',
                            }),
                        );
                        await page.goto(`${origin}/verify?token=synthetic-scroll-fixture`);
                        await page.addScriptTag({ content: scrollSource });
                        await page.addScriptTag({ content: scrollSource });
                        assert.equal(await page.locator("#fc-native-dialog-scroll").count(), 1);
                        await page.evaluate((scenario) => {
                            scrollTo(0, 400);
                            if (scenario === "existing-lock") document.documentElement.style.setProperty("overflow", "hidden", "important");
                        }, scenario);
                        if (scenario === "nested")
                            await page.evaluate(() => {
                                const parent = document.createElement("dialog");
                                parent.id = "parent-dialog";
                                parent.textContent = "Parent fixture";
                                document.body.append(parent);
                                parent.showModal();
                            });
                        if (kind === "authentication") {
                            await page.addScriptTag({ content: authSource });
                            await page.getByRole("button", { name: "Okay", exact: true }).waitFor();
                        } else {
                            await page.addStyleTag({ content: dialogStyle });
                            await page.addScriptTag({
                                content: `const escape=value=>value;const t=value=>value;const svg=()=>"";const CLOSE_PATH="";const reducedMotion=()=>true;${dialogSource};window.fixtureDialog=dialog("Fixture encryption",(body,actions,handle)=>{const button=document.createElement("button");button.textContent="Confirm";button.onclick=handle.close;actions.append(button);return button;});`,
                            });
                            if (scenario === "locked") await page.evaluate(() => fixtureDialog.setDismissable(false));
                            if (scenario === "scrollable-body")
                                await page.evaluate(() => {
                                    const content = document.createElement("div");
                                    content.style.minHeight = "2000px";
                                    content.textContent = "Long dialog fixture";
                                    document.querySelector(".fe2ee-dialog-body").append(content);
                                });
                        }
                        const before = await page.evaluate(() => scrollY);
                        assert.equal(before, 400);
                        await page.mouse.move(4, 4);
                        await page.mouse.wheel(0, 500);
                        await page.waitForTimeout(250);
                        assert.equal(await page.evaluate(() => scrollY), before, `${kind}/${scenario}: background is locked`);
                        if (scenario === "scrollable-body") {
                            const body = page.locator(".fe2ee-dialog-body");
                            await body.hover();
                            await page.mouse.wheel(0, 500);
                            await page.waitForFunction(() => document.querySelector(".fe2ee-dialog-body").scrollTop > 0);
                            assert.equal(await page.evaluate(() => scrollY), before, "Dialog content scrolls without moving the background");
                        }
                        if (scenario === "locked") {
                            await page.keyboard.press("Escape");
                            assert.equal(await page.locator(":modal").count(), 1);
                            assert.equal(await page.evaluate(() => scrollY), before);
                        }
                        await page
                            .getByRole("button", {
                                name: kind === "authentication" ? "Okay" : "Confirm",
                                exact: true,
                            })
                            .click();
                        await page.waitForFunction((nested) => document.querySelectorAll(":modal").length === (nested ? 1 : 0), scenario === "nested");
                        assert.equal(await page.evaluate(() => scrollY), before);
                        if (scenario === "nested") {
                            await page.mouse.wheel(0, 500);
                            await page.waitForTimeout(250);
                            assert.equal(await page.evaluate(() => scrollY), before, "Closing a child preserves the parent lock");
                            await page.evaluate(() => document.querySelector("#parent-dialog").close());
                        }
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
                            assert.equal(await page.evaluate(() => scrollY), before);
                            await page.evaluate(() => document.documentElement.style.removeProperty("overflow"));
                        }
                        await page.mouse.move(4, 4);
                        await page.mouse.wheel(0, 500);
                        await page.waitForFunction((before) => scrollY > before, before, { timeout: 5000 });
                    } finally {
                        await page.close();
                    }
                }
            } finally {
                await browser.close();
            }
        });
    }
}
