const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { homedir } = require("node:os");
const { createRequire } = require("node:module");
const { chromiumPath } = require("../util/chromium.cjs");
let chromium;
try {
    chromium = require("playwright-core").chromium;
} catch {
    try {
        chromium = createRequire(path.join(homedir(), ".cache/fosscord-tools/package.json"))("playwright-core").chromium;
    } catch {}
}
const browserPath = chromiumPath();
const source = fs.readFileSync("assets/public/admin/admin.js", "utf8");
const helpers = source.slice(source.indexOf("const $ ="), source.indexOf("const snowflakeDate ="));
const render = source.slice(source.indexOf("async function renderOfficialInbox("));
const response = (username) => ({
    user: { id: "22", username },
    official: { id: "1" },
    messages: [],
    before: null,
    has_more: false,
    max_characters: 2000,
});
async function fixture(browser) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.setContent('<main id="view"></main>');
    await page.addStyleTag({ content: fs.readFileSync("assets/public/admin/admin.css", "utf8") });
    page.setDefaultTimeout(5000);
    await page.addScriptTag({
        content:
            helpers +
            `
 const userName=user=>user.username;
 const userTag=user=>"@"+user.username;
 const avatar=()=>raw("");
 const debounce=fn=>fn;
 const fmtDate=value=>value;
 const act=()=>{throw new Error("Unexpected send in load-error fixture");};
 window.requests=[];
 const api=(url,options)=>url.startsWith("/admin/conversations?")?Promise.resolve({users:[{id:"11",username:"First recipient",has_replied:true},{id:"22",username:"Newer recipient"}],has_more:false,offset:2}):new Promise((resolve,reject)=>requests.push({url,options,resolve,reject}));
 ` +
            render +
            `;renderOfficialInbox(document.querySelector("#view"));`,
    });
    page.on("dialog", (dialog) => dialog.accept());
    await page.waitForFunction(() => requests.length === 1);
    return page;
}
async function open(page, id) {
    await page.locator(`[data-official-user="${id}"]`).click();
}
async function resolve(page, index, data) {
    await page.evaluate(({ index, data }) => requests[index].resolve(data), { index, data });
}
async function reject(page, index, message) {
    await page.evaluate(
        async ({ index, message }) => {
            requests[index].reject(Object.assign(new Error(message), { status: 503 }));
            await Promise.resolve();
            await Promise.resolve();
        },
        { index, message },
    );
}
test("Official inbox load errors use their own generation and preserve retry drafts", {
    timeout: 20000,
    skip: !chromium || !fs.existsSync(browserPath) ? "Requires playwright-core and CHROME_PATH pointing to a Chromium browser" : false,
}, async (t) => {
    const browser = await chromium.launch({
        headless: true,
        executablePath: chromiumPath(),
    });
    try {
        await t.test("failed Refresh stops loading, announces error and restores its draft on Retry", async () => {
            const page = await fixture(browser);
            try {
                await open(page, "11");
                await resolve(page, 0, response("First recipient"));
                await page.getByRole("heading", { name: "First recipient" }).waitFor();
                const draft = 'Keep this draft <img src=x onerror="window.injected=true">';
                await page.locator("#official-send textarea").fill(draft);
                await page.getByRole("button", { name: "Refresh", exact: true }).click();
                await reject(page, 1, "Refresh temporarily unavailable");
                await page.getByRole("alert").waitFor();
                assert.equal(await page.getByRole("status").filter({ hasText: "Loading" }).count(), 0);
                assert.equal(await page.getByRole("alert").innerText(), "Refresh temporarily unavailable");
                assert.equal(await page.getByLabel("Unsent message").inputValue(), draft);
                assert.equal(await page.locator("img").count(), 0);
                if (process.env.SAVE_UI_SCREENSHOT) await page.screenshot({ path: process.env.SAVE_UI_SCREENSHOT });
                await page.getByRole("button", { name: "Retry loading conversation", exact: true }).click();
                assert.equal(await page.evaluate(() => requests[2].url), "/admin/conversations/11");
                await resolve(page, 2, response("First recipient"));
                await page.locator("#official-send textarea").waitFor();
                assert.equal(await page.locator("#official-send textarea").inputValue(), draft);
                assert.equal(await page.locator("#official-send").getAttribute("data-dirty"), "true");
                assert.equal(await page.getByRole("alert").count(), 0);
            } finally {
                await page.close();
            }
        });
        await t.test("delayed non-abort failure cannot overwrite a newer successful user selection", async () => {
            const page = await fixture(browser);
            try {
                await open(page, "11");
                await open(page, "22");
                assert.equal(await page.evaluate(() => requests[0].options.signal.aborted), true);
                await resolve(page, 1, response("Newer recipient"));
                await page.getByRole("heading", { name: "Newer recipient" }).waitFor();
                await page.locator("#official-send textarea").fill("Newer recipient draft");
                await reject(page, 0, "Old request failed late");
                assert.equal(await page.getByRole("heading", { name: "Newer recipient" }).count(), 1);
                assert.equal(await page.getByRole("alert").count(), 0);
                assert.equal(await page.locator("#official-send textarea").inputValue(), "Newer recipient draft");
                assert.equal(await page.getByRole("button", { name: "Retry loading conversation" }).count(), 0);
            } finally {
                await page.close();
            }
        });
        await t.test("retry failure remains retryable and keeps draft scoped to its recipient", async () => {
            const page = await fixture(browser);
            try {
                await open(page, "11");
                await resolve(page, 0, response("First recipient"));
                await page.locator("#official-send textarea").waitFor();
                await page.locator("#official-send textarea").fill("Recipient one draft");
                await page.getByRole("button", { name: "Refresh", exact: true }).click();
                await reject(page, 1, "First failure");
                await page.getByRole("button", { name: "Retry loading conversation" }).click();
                await reject(page, 2, "Retry failed");
                await page.getByRole("alert").waitFor();
                assert.equal(await page.getByLabel("Unsent message").inputValue(), "Recipient one draft");
                await open(page, "22");
                await resolve(page, 3, response("Different recipient"));
                await page.getByRole("heading", { name: "Different recipient" }).waitFor();
                assert.equal(await page.locator("#official-send textarea").inputValue(), "");
                assert.equal(await page.getByRole("alert").count(), 0);
            } finally {
                await page.close();
            }
        });
    } finally {
        await browser.close();
    }
});
