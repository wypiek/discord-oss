import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { chromiumPath } from "../util/chromium.cjs";

const playwright = createRequire(path.join(homedir(), ".cache/fosscord-tools/package.json"))("playwright-core");
const origin = process.env.ORIGIN || `http://localhost:${process.env.PORT || 3413}`;
assert.ok(["localhost", "127.0.0.1", "fosscord.localhost"].includes(new URL(origin).hostname));
const browserName = process.env.BROWSER || "chromium";
assert.ok(["chromium", "webkit"].includes(browserName));
const browser = await playwright[browserName].launch(
    browserName === "chromium"
        ? {
              executablePath: chromiumPath(),
              headless: true,
          }
        : { headless: true },
);
let retryBrowser;
const errors = [];
let sdkRequests = 0;
let rejectSdk = true;
const sockets = new Set();
const upstreamRequests = new Set();
const proxyErrors = [];
const target = new URL(origin);
assert.equal(target.protocol, "http:");
const proxy = createServer((req, res) => {
    const url = new URL(req.url, target);
    if (url.origin !== target.origin) {
        res.writeHead(400);
        res.end();
        return;
    }
    if (rejectSdk && url.pathname.endsWith("/auth/cap/widget.js")) {
        sdkRequests++;
        res.writeHead(503, { "cache-control": "no-store" });
        res.end();
        return;
    }
    if (process.env.VENCORD_OUTPUT && ["/assets/vencord/vencord.js", "/assets/vencord/vencord.css"].includes(url.pathname)) {
        res.writeHead(200, {
            "content-type": url.pathname.endsWith(".js") ? "application/javascript" : "text/css",
            "cache-control": "no-store",
        });
        res.end(readFileSync(path.join(process.env.VENCORD_OUTPUT, path.basename(url.pathname))));
        return;
    }
    const upstream = httpRequest(url, { method: req.method, headers: { ...req.headers, host: target.host } }, (incoming) => {
        res.writeHead(incoming.statusCode, incoming.headers);
        incoming.pipe(res);
        incoming.on("error", (error) => {
            proxyErrors.push(error.message);
            res.destroy();
        });
    });
    upstreamRequests.add(upstream);
    upstream.on("close", () => upstreamRequests.delete(upstream));
    upstream.on("error", (error) => {
        proxyErrors.push(error.message);
        res.destroy();
    });
    req.pipe(upstream);
});
proxy.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
});
await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
const retryOrigin = `http://127.0.0.1:${proxy.address().port}`;
try {
    const context = await browser.newContext(browserName === "webkit" ? playwright.devices["iPhone 13"] : {});
    const page = await context.newPage();
    const prepare = async (target) => {
        target.on("pageerror", (error) => {
            if (!error.message.includes("Sentry successfully disabled")) errors.push(error.message);
        });
        if (process.env.VENCORD_OUTPUT) {
            for (const [file, contentType] of [
                ["vencord.js", "application/javascript"],
                ["vencord.css", "text/css"],
            ]) {
                await target.route(
                    (url) => url.pathname.endsWith(`/vencord/${file}`),
                    (route) => route.fulfill({ path: path.join(process.env.VENCORD_OUTPUT, file), contentType }),
                );
            }
        }
    };
    await prepare(page);
    let registrations = 0;
    page.on("request", (request) => {
        if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/auth/register")) registrations++;
    });
    await page.goto(`${origin}/register`);
    const widget = page.locator("cap-widget[required]");
    await widget.waitFor();
    await page.locator('input[name="global_name"]').fill("Accessibility fixture");
    await page.locator('input[name="username"]').fill(`capfocus${Date.now()}`);
    await page.locator('input[name="password"]').fill(`${crypto.randomUUID()}A9`);
    await page.keyboard.press("Tab");
    await page.locator("form").evaluate((form) => form.requestSubmit());
    const error = page.locator("#fosscord-cap-error");
    await error.waitFor();
    assert.equal(await error.getAttribute("role"), "alert");
    assert.equal(await error.getAttribute("aria-atomic"), "true");
    const focused = await widget.evaluate((element) => {
        const trigger = element.shadowRoot.querySelector('[part="trigger"]');
        const description = element.shadowRoot.getElementById(trigger.getAttribute("aria-describedby"));
        return {
            focused: document.activeElement === element && element.shadowRoot.activeElement === trigger,
            invalid: trigger.getAttribute("aria-invalid"),
            description: description?.textContent,
            focusVisible: trigger.matches(":focus-visible"),
        };
    });
    assert.equal(focused.focused, true);
    assert.equal(focused.invalid, "true");
    assert.equal(focused.focusVisible, true);
    assert.match(focused.description, /Complete the verification before creating your account/);
    if (browserName === "chromium") {
        const cdp = await context.newCDPSession(page);
        const { nodes } = await cdp.send("Accessibility.getFullAXTree");
        const button = nodes.find((node) => node.role?.value === "button" && node.name?.value === "Click to verify you're a human");
        assert.match(button?.description?.value, /Complete the verification before creating your account/);
        await cdp.detach();
    }
    assert.equal(registrations, 0);
    if (process.env.CAP_ACCESSIBILITY_SCREENSHOT) {
        await error.scrollIntoViewIfNeeded();
        await page.screenshot({ path: process.env.CAP_ACCESSIBILITY_SCREENSHOT });
    }
    await page.keyboard.press("Enter");
    await page.getByText("Verified. You can create your account.", { exact: true }).waitFor({ timeout: 60000 });
    assert.equal(await error.count(), 0);
    assert.equal(await widget.evaluate((element) => element.shadowRoot.querySelector('[part="trigger"]').hasAttribute("aria-invalid")), false);
    assert.equal(await page.locator("#fosscord-cap-status").getAttribute("role"), "status");
    await widget.evaluate((element) => element.reset());
    await page.locator("form").evaluate((form) => form.requestSubmit());
    await error.waitFor();
    assert.equal(await widget.evaluate((element) => element.shadowRoot.activeElement?.getAttribute("part")), "trigger");
    assert.equal(registrations, 0);
    await context.close();
    await browser.close();
    retryBrowser = await playwright[browserName].launch(
        browserName === "chromium"
            ? {
                  executablePath: chromiumPath(),
                  headless: true,
              }
            : { headless: true },
    );
    const retryContext = await retryBrowser.newContext(browserName === "webkit" ? playwright.devices["iPhone 13"] : {});
    const retryPage = await retryContext.newPage();
    await prepare(retryPage);
    await retryPage.goto(`${retryOrigin}/register`);
    const retry = retryPage.getByRole("button", { name: "Retry verification", exact: true });
    await retry.waitFor();
    assert.ok(sdkRequests > 0, "The native SDK request reached the failing HTTP proxy");
    await retryPage.bringToFront();
    await retryPage.keyboard.press("Tab");
    await retry.focus();
    assert.equal(await retry.evaluate((element) => element.matches(":focus-visible")), true);
    assert.ok(await retry.evaluate((element) => element.getBoundingClientRect().height >= (matchMedia("(pointer: coarse)").matches ? 44 : 40)));
    rejectSdk = false;
    await retryPage.keyboard.press("Enter");
    await retryPage.locator("cap-widget[required]").waitFor();
    assert.equal(await retry.count(), 0);
    assert.deepEqual(errors, []);
    assert.deepEqual(proxyErrors, []);
    console.log(
        JSON.stringify({
            browser: browserName,
            invalidSubmitFocus: true,
            keyboardSolve: true,
            errorCleared: true,
            resetFocus: true,
            sdkRetryKeyboard: true,
            registrationRequests: registrations,
        }),
    );
} finally {
    await retryBrowser?.close();
    await browser.close();
    for (const request of upstreamRequests) request.destroy();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve, reject) => proxy.close((error) => (error ? reject(error) : resolve())));
}
