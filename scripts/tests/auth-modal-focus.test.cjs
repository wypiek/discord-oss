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
const source = fs.readFileSync("assets/client_patches/60-auth-pages.js", "utf8");
const origin = "http://localhost:3413";
const fixture = '<!doctype html><title>Fixture instance</title><button id="opener">Open authentication dialog</button><button id="outside">Outside action</button>';
const remotePath = `/ra/${"A".repeat(43)}`;

for (const browserName of ["chromium", "webkit"]) {
    test(`${browserName} authentication dialogs restore opener focus and retain required dismissal`, {
        skip: !playwright || (browserName === "chromium" && !fs.existsSync(executablePath)),
        timeout: 120000,
    }, async () => {
        const browser = await playwright[browserName].launch(browserName === "chromium" ? { executablePath, headless: true } : { headless: true });
        try {
            for (const scenario of ["email-failed", "email-verified", "remote-expired", "remote-cancel", "remote-finish", "nested-email-failed"]) {
                {
                    const context = await browser.newContext(browserName === "webkit" ? playwright.devices["iPhone 13"] : {});
                    const page = await context.newPage();
                    const pageErrors = [];
                    const calls = [];
                    page.on("pageerror", (error) => pageErrors.push(error.message));
                    const remote = scenario.startsWith("remote-");
                    const routePath = remote ? remotePath : "/verify?token=synthetic-focus-fixture";
                    await page.route(`${origin}${routePath}`, (route) => route.fulfill({ contentType: "text/html", body: fixture }));
                    await page.route(`${origin}/api/v9/**`, (route) => {
                        const pathname = new URL(route.request().url()).pathname;
                        calls.push(pathname);
                        if (pathname.endsWith("/auth/verify"))
                            return route.fulfill({
                                status: scenario === "email-verified" ? 200 : 400,
                                contentType: "application/json",
                                body: JSON.stringify({ token: "synthetic-verification-result" }),
                            });
                        if (pathname.endsWith("/users/@me"))
                            return route.fulfill({
                                contentType: "application/json",
                                body: JSON.stringify({
                                    id: "123456789012345678",
                                    username: "Fixture account",
                                    discriminator: "0",
                                }),
                            });
                        if (pathname.endsWith("/remote-auth"))
                            return route.fulfill({
                                status: scenario === "remote-expired" ? 400 : 200,
                                contentType: "application/json",
                                body: JSON.stringify({ handshake_token: "synthetic-handshake" }),
                            });
                        if (pathname.endsWith("/remote-auth/finish") || pathname.endsWith("/remote-auth/cancel"))
                            return route.fulfill({ contentType: "application/json", body: "{}" });
                        return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
                    });
                    try {
                        await page.goto(`${origin}${routePath}`);
                        if (remote || scenario === "email-verified") await page.evaluate(() => localStorage.setItem("token", JSON.stringify("synthetic-access-token")));
                        if (scenario.startsWith("nested-"))
                            await page.evaluate(() => {
                                const parent = document.createElement("dialog");
                                parent.id = "parent-dialog";
                                document.body.append(parent);
                                parent.append(document.querySelector("#opener"));
                                parent.showModal();
                            });
                        await page.locator("#opener").focus();
                        await page.addScriptTag({ content: source });
                        const actionName =
                            scenario === "email-verified"
                                ? "Continue to Fixture instance"
                                : scenario === "remote-expired"
                                  ? "Close"
                                  : scenario === "remote-cancel"
                                    ? "Cancel"
                                    : scenario === "remote-finish"
                                      ? "Log In"
                                      : "Okay";
                        const action = page.getByRole("button", { name: actionName, exact: true });
                        await action.waitFor();
                        assert.equal(await page.locator(".fc-auth-backdrop:modal").count(), 1);
                        assert.equal(await page.evaluate(() => document.querySelector(".fc-auth-backdrop").contains(document.activeElement)), true);
                        await page.locator("#outside").evaluate((element) => element.focus());
                        assert.equal(await page.evaluate(() => document.activeElement.id === "outside"), false, "Underlying controls are inert");
                        await page.keyboard.press("Escape");
                        assert.equal(await page.locator(".fc-auth-backdrop:modal").count(), 1, "Escape cannot bypass authentication decisions");
                        await page.mouse.click(4, 4);
                        assert.equal(await page.locator(".fc-auth-backdrop:modal").count(), 1, "Outside clicks cannot bypass authentication decisions");
                        await action.click();
                        if (scenario === "remote-finish") {
                            const done = page.getByRole("button", { name: "Done", exact: true });
                            await done.waitFor();
                            assert.equal(await done.evaluate((element) => element === document.activeElement), true, "The completion action receives focus after replacement");
                            await done.click();
                        }
                        await page.waitForFunction(() => !document.querySelector(".fc-auth-backdrop"));
                        assert.equal(await page.evaluate(() => document.activeElement.id), "opener");
                        assert.equal(await page.locator(":modal").count(), scenario.startsWith("nested-") ? 1 : 0);
                        assert.equal(calls.filter((value) => value.endsWith("/remote-auth/finish")).length, scenario === "remote-finish" ? 1 : 0);
                        assert.equal(calls.filter((value) => value.endsWith("/remote-auth/cancel")).length, scenario === "remote-cancel" ? 1 : 0);
                        assert.deepEqual(pageErrors, []);
                    } finally {
                        await context.close();
                    }
                }
            }
        } finally {
            await browser.close();
        }
    });
}

const adminSource = fs.readFileSync("assets/public/admin/admin.js", "utf8");
const drawerSource = adminSource.slice(adminSource.indexOf("let drawerReturnFocus;"), adminSource.indexOf("function filterNavigation()"));
const drawerFixture =
    '<!doctype html><div id="app"><button id="opener">Open drawer</button><input id="nav-search"></div><form id="login-form" hidden><input name="login"></form><div id="drawer" class="drawer" hidden><div class="drawer-backdrop" data-close></div><section class="drawer-panel" role="dialog" aria-labelledby="drawer-title"><header class="drawer-head"><h2 id="drawer-title"></h2><button data-close>Close</button></header><div id="drawer-body"></div></section></div>';
for (const browserName of ["chromium", "webkit"]) {
    test(`${browserName} admin drawers restore usable opener focus or visible navigation`, {
        skip: !playwright || (browserName === "chromium" && !fs.existsSync(executablePath)),
        timeout: 120000,
    }, async () => {
        const browser = await playwright[browserName].launch(browserName === "chromium" ? { executablePath, headless: true } : { headless: true });
        try {
            for (const scenario of [
                "close-button",
                "escape",
                "backdrop",
                "removed",
                "disabled",
                "aria-disabled",
                "hidden",
                "invisible",
                "collapsed",
                "inert",
                "signed-out",
                "dirty-cancel",
                "existing-scroll-lock",
                "mixed-scroll-axes",
                "replace-drawer",
            ]) {
                {
                    const page = await browser.newPage(browserName === "webkit" ? playwright.devices["iPhone 13"] : {});
                    try {
                        await page.setContent(drawerFixture);
                        await page.addStyleTag({
                            content: fs.readFileSync("assets/public/admin/admin.css", "utf8"),
                        });
                        await page.addScriptTag({
                            content: `const $=(s,r=document)=>r.querySelector(s);const mount=(e,c)=>e.innerHTML=c;${drawerSource};window.openFixture=()=>openDrawer("Fixture","<form><input name=fixture></form>");`,
                        });
                        await page.locator("#opener").focus();
                        const scrollState = await page.evaluate((scenario) => {
                            if (scenario === "existing-scroll-lock") document.body.style.setProperty("overflow", "hidden", "important");
                            if (["mixed-scroll-axes", "replace-drawer", "dirty-cancel"].includes(scenario)) {
                                document.body.style.setProperty("overflow-x", "clip");
                                document.body.style.setProperty("overflow-y", "auto", "important");
                            }
                            return ["overflow-x", "overflow-y"].map((property) => [
                                document.body.style.getPropertyValue(property),
                                document.body.style.getPropertyPriority(property),
                            ]);
                        }, scenario);
                        await page.evaluate(() => openFixture());
                        await page.evaluate(() => document.body.style.setProperty("padding-bottom", "13px"));
                        if (scenario === "replace-drawer") await page.evaluate(() => openFixture());
                        assert.equal(await page.getByRole("button", { name: "Close", exact: true }).evaluate((element) => element === document.activeElement), true);
                        if (scenario === "removed") await page.locator("#opener").evaluate((element) => element.remove());
                        if (scenario === "disabled") await page.locator("#opener").evaluate((element) => (element.disabled = true));
                        if (scenario === "aria-disabled") await page.locator("#opener").evaluate((element) => element.setAttribute("aria-disabled", "true"));
                        if (scenario === "invisible") await page.locator("#opener").evaluate((element) => (element.style.visibility = "hidden"));
                        if (scenario === "collapsed") await page.locator("#opener").evaluate((element) => (element.style.visibility = "collapse"));
                        if (scenario === "hidden") await page.locator("#opener").evaluate((element) => (element.hidden = true));
                        if (scenario === "inert") await page.locator("#opener").evaluate((element) => (element.inert = true));
                        if (scenario === "signed-out")
                            await page.evaluate(() => {
                                document.querySelector("#app").hidden = true;
                                document.querySelector("#login-form").hidden = false;
                            });
                        if (scenario === "dirty-cancel") {
                            await page.evaluate(() => {
                                document.querySelector("#drawer form").dataset.dirty = "true";
                                window.confirm = () => false;
                            });
                            await page.getByRole("button", { name: "Close", exact: true }).click();
                            assert.equal(await page.locator("#drawer").evaluate((element) => element.hidden), false);
                            assert.equal(await page.locator("#app").evaluate((element) => element.inert), true);
                            assert.equal(await page.evaluate(() => document.body.style.overflow), "hidden");
                            await page.evaluate(() => {
                                window.confirm = () => true;
                            });
                        }
                        if (scenario === "escape") await page.keyboard.press("Escape");
                        else if (scenario === "backdrop") await page.locator(".drawer-backdrop").click({ position: { x: 4, y: 4 } });
                        else await page.getByRole("button", { name: "Close", exact: true }).click();
                        const focused = await page.evaluate(() => document.activeElement.id || document.activeElement.getAttribute("name"));
                        const expected = ["removed", "disabled", "aria-disabled", "hidden", "invisible", "collapsed", "inert"].includes(scenario)
                            ? "nav-search"
                            : scenario === "signed-out"
                              ? "login"
                              : "opener";
                        assert.equal(focused, expected);
                        assert.equal(await page.locator("#drawer").evaluate((element) => element.hidden), true);
                        assert.equal(await page.locator("#app").evaluate((element) => element.inert), false);
                        assert.deepEqual(
                            await page.evaluate(() =>
                                ["overflow-x", "overflow-y"].map((property) => [document.body.style.getPropertyValue(property), document.body.style.getPropertyPriority(property)]),
                            ),
                            scrollState,
                        );
                        assert.equal(await page.evaluate(() => document.body.style.paddingBottom), "13px");
                        await page.evaluate(() => closeDrawer());
                        assert.deepEqual(
                            await page.evaluate(() =>
                                ["overflow-x", "overflow-y"].map((property) => [document.body.style.getPropertyValue(property), document.body.style.getPropertyPriority(property)]),
                            ),
                            scrollState,
                        );
                    } finally {
                        await page.close();
                    }
                }
            }
        } finally {
            await browser.close();
        }
    });
}

const portalSource = fs.readFileSync("assets/public/developers/portal.js", "utf8");
const confirmSource = portalSource.slice(sourceMarker(portalSource, "    const confirmDialog ="), sourceMarker(portalSource, "    const switchRow ="));
const uiSource = fs.readFileSync("client/e2ee/src/ui.ts", "utf8");
const dialogSource = require("typescript").transpileModule(uiSource.slice(sourceMarker(uiSource, "    const dialog ="), sourceMarker(uiSource, "    const field =")), {
    compilerOptions: { target: require("typescript").ScriptTarget.ES2022 },
}).outputText;
for (const browserName of ["chromium", "webkit"]) {
    test(`${browserName} existing portal and encryption dialog factories restore their opener`, {
        skip: !playwright || (browserName === "chromium" && !fs.existsSync(executablePath)),
        timeout: 120000,
    }, async () => {
        const browser = await playwright[browserName].launch(browserName === "chromium" ? { executablePath, headless: true } : { headless: true });
        try {
            for (const kind of ["portal", "encryption"]) {
                for (const scenario of kind === "portal" ? ["confirm", "cancel", "escape"] : ["close", "escape", "backdrop", "locked", "nested", "animated-close"]) {
                    const page = await browser.newPage();
                    const errors = [];
                    page.on("pageerror", (error) => errors.push(error.message));
                    try {
                        await page.setContent('<!doctype html><button id="opener">Open dialog</button>');
                        if (kind === "portal")
                            await page.addScriptTag({
                                content: `const el=(tag,props,...children)=>{const node=document.createElement(tag);for(const [name,value] of Object.entries(props))node.setAttribute(name,value);node.append(...children);return node;};${confirmSource};document.querySelector("#opener").onclick=()=>{window.confirmResult=undefined;confirmDialog({title:"Fixture confirmation",body:"Fixture action",action:"Confirm"}).then(value=>window.confirmResult=value);};`,
                            });
                        else
                            await page.addScriptTag({
                                content: `const escape=value=>value;const t=value=>value;const svg=()=>"";const CLOSE_PATH="";const reducedMotion=()=>${scenario !== "animated-close"};${dialogSource};document.querySelector("#opener").onclick=()=>{window.fixtureDialog=dialog("Fixture encryption",(body,actions,handle)=>{const confirm=document.createElement("button");confirm.textContent="Confirm";confirm.onclick=handle.close;actions.append(confirm);return confirm;});};`,
                            });
                        if (scenario === "nested")
                            await page.evaluate(() => {
                                const parent = document.createElement("dialog");
                                parent.id = "parent-dialog";
                                document.body.append(parent);
                                parent.append(document.querySelector("#opener"));
                                parent.showModal();
                            });
                        await page.locator("#opener").focus();
                        await page.keyboard.press("Enter");
                        assert.equal(await page.locator(":modal").count(), scenario === "nested" ? 2 : 1);
                        if (scenario === "locked") {
                            await page.evaluate(() => fixtureDialog.setDismissable(false));
                            await page.keyboard.press("Escape");
                            await page.mouse.click(4, 4);
                            assert.equal(await page.locator("dialog.fe2ee-dialog:modal").count(), 1, "Locked encryption dialogs remain required");
                            await page.getByRole("button", { name: "Confirm", exact: true }).click();
                        } else if (scenario === "escape") await page.keyboard.press("Escape");
                        else if (scenario === "backdrop") await page.mouse.click(4, 4);
                        else
                            await page
                                .getByRole("button", {
                                    name: kind === "encryption" ? "Close" : scenario === "confirm" ? "Confirm" : "Cancel",
                                    exact: true,
                                })
                                .click();
                        await page.waitForFunction((nested) => document.querySelectorAll(":modal").length === (nested ? 1 : 0), scenario === "nested");
                        assert.equal(await page.evaluate(() => document.activeElement.id), "opener", `${kind}/${scenario} must restore the focused opener`);
                        if (kind === "portal") {
                            await page.waitForFunction(() => typeof confirmResult === "boolean");
                            assert.equal(await page.evaluate(() => confirmResult), scenario === "confirm");
                        }
                        assert.deepEqual(errors, []);
                    } finally {
                        await page.close();
                    }
                }
            }
        } finally {
            await browser.close();
        }
    });
}
