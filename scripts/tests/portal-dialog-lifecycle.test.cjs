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
const elementSource = source.slice(sourceMarker(source, "    const el ="), sourceMarker(source, "    const errorText ="));
const errorSource = source.slice(sourceMarker(source, "    const errorLine ="), sourceMarker(source, "    const flash ="));
const factories = {
    application: source.slice(sourceMarker(source, "    const createDialog ="), sourceMarker(source, "    const widgetDialog =")),
    widget: source.slice(sourceMarker(source, "    const widgetDialog ="), sourceMarker(source, "    const setNav =")),
};
const renderSource = source.slice(
    sourceMarker(source, "    const render = async () =>"),
    sourceMarker(source, "\n    render();", sourceMarker(source, "    const render = async () =>")),
);
const confirmationSource = source.slice(sourceMarker(source, "    const confirmDialog ="), sourceMarker(source, "    const switchRow ="));
for (const browserName of ["chromium", "webkit"]) {
    test(`${browserName} portal create dialogs do not navigate after dismissal or route change`, {
        skip: !playwright || (browserName === "chromium" && !fs.existsSync(executablePath)),
        timeout: 30000,
    }, async () => {
        const browser = await playwright[browserName].launch(browserName === "chromium" ? { executablePath, headless: true } : { headless: true });
        try {
            for (const kind of ["application", "widget"]) {
                for (const scenario of ["success-open", "cancel-pending", "escape-pending", "queued-close", "route-change", "failure-open", "failure-closed"]) {
                    const page = await browser.newPage();
                    try {
                        const origin = "http://localhost:3413";
                        await page.route(`${origin}/developers/applications`, (route) =>
                            route.fulfill({
                                contentType: "text/html",
                                body: '<!doctype html><main id="view" tabindex="-1"></main>',
                            }),
                        );
                        await page.goto(`${origin}/developers/applications`);
                        await page.addStyleTag({
                            content: fs.readFileSync("assets/public/developers/portal.css", "utf8"),
                        });
                        await page.addScriptTag({
                            content: `let renderVersion=0;let widgetRequestVersion=0;${elementSource};${errorSource};window.routes=[];const navigate=path=>routes.push(path);const view=document.querySelector("#view");const renderList=async()=>{};const renderApp=async()=>{};const avatarUrl=()=>null;const api=(method,path)=>method==="GET"?Promise.resolve({global_name:"Fixture",avatar:null}):new Promise((resolve,reject)=>{window.releaseCreate=resolve;window.rejectCreate=reject;});${factories[kind]};${renderSource};void ${kind === "application" ? "createDialog" : "widgetDialog"}();`,
                        });
                        await page.locator(kind === "application" ? "#new-app-name" : "#new-widget-name").fill("Fixture creation");
                        await page.getByRole("button", { name: "Create", exact: true }).evaluate((button) => (window.savedSubmit = button));
                        await page.getByRole("button", { name: "Create", exact: true }).click();
                        assert.equal(await page.getByRole("button", { name: "Create", exact: true }).isDisabled(), true);
                        if (["cancel-pending", "failure-closed"].includes(scenario)) await page.getByRole("button", { name: "Cancel", exact: true }).click();
                        if (scenario === "escape-pending") await page.keyboard.press("Escape");
                        if (scenario === "route-change") await page.evaluate(() => render());
                        await page.evaluate((scenario) => {
                            if (scenario === "queued-close") document.querySelector(":modal").close();
                            if (scenario.startsWith("failure-")) rejectCreate(new Error("Fixture creation failure"));
                            else releaseCreate({ id: "123456789012345678" });
                        }, scenario);
                        await page.waitForFunction(() => savedSubmit.disabled === false);
                        if (scenario === "success-open")
                            assert.deepEqual(await page.evaluate(() => routes), [
                                `/developers/applications/123456789012345678/${kind === "application" ? "information" : "widget"}`,
                            ]);
                        else assert.deepEqual(await page.evaluate(() => routes), []);
                        if (scenario === "failure-open") {
                            assert.equal(await page.locator(":modal").count(), 1);
                            assert.equal(await page.getByRole("alert").textContent(), "Fixture creation failure");
                        } else await page.waitForFunction(() => !document.querySelector("dialog"));
                    } finally {
                        await page.close();
                    }
                }
            }
            for (const changed of [false, true, "duplicate"]) {
                const page = await browser.newPage();
                try {
                    await page.setContent("<!doctype html><main id=view></main>");
                    await page.addScriptTag({
                        content: `let renderVersion=0;let widgetRequestVersion=0;${elementSource};${errorSource};const view=document.querySelector("#view");const renderList=async()=>{};const renderApp=async()=>{};const avatarUrl=()=>null;const navigate=()=>{};window.userReads=[];const api=()=>new Promise(resolve=>window.userReads.push(resolve));${factories.widget};${renderSource};window.widgetFinished=false;void widgetDialog().then(()=>window.widgetFinished=true);`,
                    });
                    if (changed === true) await page.evaluate(() => render());
                    if (changed === "duplicate")
                        await page.evaluate(() => {
                            window.secondFinished = false;
                            void widgetDialog().then(() => (window.secondFinished = true));
                        });
                    await page.evaluate(() => userReads.forEach((resolve) => resolve({ username: "Fixture", avatar: null })));
                    if (changed === "duplicate") await page.waitForFunction(() => secondFinished);
                    await page.waitForFunction(() => widgetFinished);
                    assert.equal(await page.locator("dialog").count(), changed === true ? 0 : 1, "A delayed user read must not open a widget after a route render");
                } finally {
                    await page.close();
                }
            }
            const page = await browser.newPage();
            try {
                await page.route("http://localhost:3413/developers/applications", (route) =>
                    route.fulfill({
                        contentType: "text/html",
                        body: '<!doctype html><main id="view" tabindex="-1"></main>',
                    }),
                );
                await page.goto("http://localhost:3413/developers/applications");
                await page.addScriptTag({
                    content: `let renderVersion=0;let widgetRequestVersion=0;${elementSource};${confirmationSource};const view=document.querySelector("#view");const renderList=async()=>{};const renderApp=async()=>{};const navigate=()=>{};${renderSource};window.decision=undefined;void confirmDialog({title:"Fixture confirmation",body:"Fixture decision",action:"Confirm"}).then(value=>window.decision=value);`,
                });
                await page.locator(":modal").waitFor();
                await page.evaluate(() => render());
                await page.waitForFunction(() => typeof decision === "boolean");
                assert.equal(await page.evaluate(() => decision), false);
                assert.equal(await page.locator("dialog").count(), 0);
            } finally {
                await page.close();
            }
        } finally {
            await browser.close();
        }
    });
}
