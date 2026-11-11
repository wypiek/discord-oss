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
const source = fs.readFileSync("assets/public/admin/admin.js", "utf8");
const showLoginSource = source.slice(sourceMarker(source, "function showLogin("), sourceMarker(source, "function syncBrandIcon("));
const drawerSource = source.slice(sourceMarker(source, "let drawerReturnFocus;"), sourceMarker(source, "function filterNavigation()"));
const userStart = sourceMarker(source, "async function openUser(");
const guildStart = sourceMarker(source, "async function openGuild(");
const editorSources = {
    user: `${source.slice(userStart, sourceMarker(source, "    const cosmeticOf =", userStart))}window.editorMounted=true;}`,
    guild: `${source.slice(guildStart, sourceMarker(source, "    const features =", guildStart))}window.editorMounted=true;}`,
};
for (const browserName of ["chromium", "webkit"]) {
    test(`${browserName} admin sign-in clears stale editors, authorization and page requests`, {
        skip: !playwright || (browserName === "chromium" && !fs.existsSync(executablePath)),
        timeout: 30000,
    }, async () => {
        const browser = await playwright[browserName].launch(browserName === "chromium" ? { executablePath, headless: true } : { headless: true });
        try {
            for (const scenario of ["dirty-drawer", "clean-drawer", "closed-drawer", "user-success", "user-cancel", "guild-success", "guild-cancel"]) {
                const page = await browser.newPage();
                try {
                    await page.setContent(
                        '<!doctype html><div id="login" hidden><form id="login-form"><input name="login"><p id="login-error" hidden></p></form></div><div id="app"><button id="opener">Open drawer</button><input id="nav-search"><div id="me">Private fixture identity</div><div id="view">Private fixture content</div></div><div id="drawer" class="drawer" hidden><section class="drawer-panel"><header class="drawer-head"><h2 id="drawer-title"></h2><button>Close</button></header><div id="drawer-body"></div></section></div>',
                    );
                    await page.addStyleTag({
                        content: fs.readFileSync("assets/public/admin/admin.css", "utf8"),
                    });
                    await page.addScriptTag({
                        content: `const $=(selector,root=document)=>root.querySelector(selector);const mount=(node,content)=>node.innerHTML=content;const state={overview:{access:{operator:true}},me:{id:"fixture"}};let pageRequests=new AbortController();window.originalRequests=pageRequests;window.confirmations=0;window.confirm=()=>{confirmations++;return false;};${drawerSource};${showLoginSource}`,
                    });
                    await page.evaluate(() => {
                        document.body.style.setProperty("overflow-x", "clip");
                        document.body.style.setProperty("overflow-y", "auto", "important");
                    });
                    const delayed = scenario.startsWith("user-") || scenario.startsWith("guild-");
                    if (delayed) {
                        const kind = scenario.split("-")[0];
                        await page.addScriptTag({
                            content: `const html=(strings,...values)=>strings.map((part,index)=>part+(values[index]??"")).join("");const pending=new Promise((resolve,reject)=>{window.releaseRead=resolve;window.rejectRead=reject;});const api=()=>pending;const getProfileCatalog=()=>pending;${editorSources[kind]};window.editorFinished=false;void ${kind === "user" ? "openUser" : "openGuild"}("fixture").then(()=>window.editorFinished=true);`,
                        });
                    } else if (scenario !== "closed-drawer")
                        await page.evaluate(
                            (scenario) => openDrawer("Fixture", `<form${scenario === "dirty-drawer" ? ' data-dirty="true"' : ""}><input value="Private fixture draft"></form>`),
                            scenario,
                        );
                    await page.evaluate(() => showLogin("Expired fixture session"));
                    if (delayed) {
                        await page.evaluate((scenario) => {
                            if (scenario.endsWith("cancel")) rejectRead(Object.assign(new Error("Fixture navigation changed"), { status: 499 }));
                            else releaseRead({ id: "fixture" });
                        }, scenario);
                        await page.waitForFunction(() => editorFinished);
                        assert.equal(await page.evaluate(() => Boolean(window.editorMounted)), false);
                    }
                    assert.equal(await page.locator("#drawer").evaluate((drawer) => drawer.hidden), true);
                    assert.equal(await page.locator("#app").evaluate((app) => app.hidden && !app.inert), true);
                    assert.equal(await page.locator("#view").textContent(), "");
                    assert.equal(await page.locator("#me").textContent(), "");
                    assert.equal(await page.locator("#drawer-body").textContent(), "");
                    assert.deepEqual(
                        await page.evaluate(() => ({
                            confirmations,
                            expired: originalRequests.signal.aborted,
                            current: pageRequests.signal.aborted,
                            overview: state.overview,
                            me: state.me,
                            focused: document.activeElement.getAttribute("name"),
                        })),
                        {
                            confirmations: 0,
                            expired: true,
                            current: false,
                            overview: null,
                            me: null,
                            focused: "login",
                        },
                    );
                    assert.deepEqual(
                        await page.evaluate(() =>
                            ["overflow-x", "overflow-y"].map((property) => [document.body.style.getPropertyValue(property), document.body.style.getPropertyPriority(property)]),
                        ),
                        [
                            ["clip", ""],
                            ["auto", "important"],
                        ],
                    );
                    assert.equal(await page.locator("#login-error").textContent(), "Expired fixture session");
                    await page.evaluate(() => showLogin());
                    assert.equal(await page.locator("#login-error").evaluate((error) => error.hidden), true);
                } finally {
                    await page.close();
                }
            }
        } finally {
            await browser.close();
        }
    });
}
