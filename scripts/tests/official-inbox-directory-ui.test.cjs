const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const { createRequire } = require("node:module");
const { homedir } = require("node:os");
const path = require("node:path");
const { chromiumPath } = require("../util/chromium.cjs");
let chromium;
try {
    chromium = require("playwright-core").chromium;
} catch {
    try {
        chromium = createRequire(path.join(homedir(), ".cache/fosscord-tools/package.json"))("playwright-core").chromium;
    } catch {
        chromium = null;
    }
}
const browserPath = chromiumPath();
const browserOptions = {
    skip: !chromium || !fs.existsSync(browserPath) ? "Requires playwright-core and CHROME_PATH pointing to Chromium" : false,
};
const source = fs.readFileSync("assets/public/admin/admin.js", "utf8");
const helpers = source.slice(source.indexOf("const $ ="), source.indexOf("const snowflakeDate ="));
const render = source.slice(source.indexOf("async function renderOfficialInbox("));
async function fixture(browser, width = 1280) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.setContent('<main id="view"></main>');
    await page.addStyleTag({ content: fs.readFileSync("assets/public/admin/admin.css", "utf8") });
    await page.addScriptTag({
        content:
            helpers +
            `
 const userName=u=>u.username;const userTag=u=>"@"+u.username;const fmtDate=date=>date;
 const avatar=u=>html\`<span class="avatar">\${u.username[0]}</span>\`;
 const debounce=(fn,ms)=>{let timer;return()=>{clearTimeout(timer);timer=setTimeout(fn,ms)}};
 const act=async(button,fn)=>{button.disabled=true;try{return await fn()}finally{button.disabled=false}};
 window.calls=[];window.pending=[];window.delaySearch=false;
 const contact=(id,name,support=false)=>({id,username:name,has_replied:support,last_incoming_at:support?"Today":null});
 const api=async(url,options={})=>{
 calls.push({url,options});
 if(url.startsWith("/admin/conversations?")){
 const parsed=new URL(url,"https://fixture.example");const q=parsed.searchParams.get("q");
 if(q&&delaySearch)return new Promise((resolve,reject)=>pending.push({q,resolve,reject}));
 return parsed.searchParams.get("offset")==="2"?{users:[contact("4","Later user")],offset:3,has_more:false}:{users:[contact("3","Support user",true),contact("2","New user")],offset:2,has_more:true};
 }
 const id=url.split("/").at(-1);return options.method==="POST"?{id:"99"}:{user:{id,username:id==="3"?"Support user":id==="2"?"New user":"Later user"},official:{id:"1"},messages:[],before:null,has_more:false,max_characters:4000};
 };` +
            render +
            ';renderOfficialInbox(document.querySelector("#view"));',
    });
    await page.getByRole("heading", { name: "Support user", exact: true }).waitFor();
    return page;
}
test("Official inbox has two panes, prioritizes support, selects users and pages the directory without a user-ID form", browserOptions, async () => {
    const browser = await chromium.launch({
        headless: true,
        executablePath: chromiumPath(),
    });
    try {
        const page = await fixture(browser);
        assert.equal(await page.locator('[name="user_id"]').count(), 0);
        assert.equal(await page.locator("[data-official-user]").first().getAttribute("data-official-user"), "3");
        const sidebar = await page.locator(".official-sidebar").boundingBox(),
            chat = await page.locator("#official-conversation").boundingBox();
        assert.ok(chat.x > sidebar.x + sidebar.width);
        await page.locator('[data-official-user="2"]').click();
        await page.getByRole("heading", { name: "New user", exact: true }).waitFor();
        await page.getByLabel("Message", { exact: true }).fill("Help response");
        await page.getByRole("button", { name: "Send as Official", exact: true }).click();
        assert.ok(
            await page.evaluate(() =>
                calls.some((call) => call.url === "/admin/conversations/2" && call.options.method === "POST" && call.options.body.content === "Help response"),
            ),
        );
        await page.getByRole("button", { name: "Load more users", exact: true }).click();
        await page.locator('[data-official-user="4"]').waitFor();
        assert.equal(await page.locator("[data-official-user]").count(), 3);
        if (process.env.SAVE_INBOX_DIRECTORY_SCREENSHOT)
            await page.screenshot({
                path: process.env.SAVE_INBOX_DIRECTORY_SCREENSHOT.replace(".png", "-desktop.png"),
                fullPage: true,
            });
        await page.setViewportSize({ width: 390, height: 844 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        if (process.env.SAVE_INBOX_DIRECTORY_SCREENSHOT)
            await page.screenshot({
                path: process.env.SAVE_INBOX_DIRECTORY_SCREENSHOT,
                fullPage: true,
            });
    } finally {
        await browser.close();
    }
});
test("late directory search results do not overwrite a newer user search", browserOptions, async () => {
    const browser = await chromium.launch({
        headless: true,
        executablePath: chromiumPath(),
    });
    try {
        const page = await fixture(browser, 390);
        await page.evaluate(() => (delaySearch = true));
        await page.getByLabel("Search users", { exact: true }).fill("older");
        await page.waitForFunction(() => pending.length === 1);
        await page.getByLabel("Search users", { exact: true }).fill("newer");
        await page.waitForFunction(() => pending.length === 2);
        await page.evaluate(() =>
            pending[1].resolve({
                users: [{ id: "22", username: "New search result" }],
                offset: 1,
                has_more: false,
            }),
        );
        await page.locator('[data-official-user="22"]').waitFor();
        await page.evaluate(() =>
            pending[0].resolve({
                users: [{ id: "11", username: "Stale result" }],
                offset: 1,
                has_more: false,
            }),
        );
        assert.equal(await page.locator('[data-official-user="11"]').count(), 0);
        assert.equal(await page.locator('[data-official-user="22"]').count(), 1);
        assert.equal(await page.getByRole("heading", { name: "Support user", exact: true }).count(), 1);
    } finally {
        await browser.close();
    }
});
