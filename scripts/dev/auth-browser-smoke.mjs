import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { inflateSync, constants } from "node:zlib";
import { chromiumPath } from "../util/chromium.cjs";

const playwright = createRequire(path.join(homedir(), ".cache/fosscord-tools/package.json"))("playwright-core");
const browserName = process.env.BROWSER || "firefox";
assert.ok(["chromium", "webkit", "firefox"].includes(browserName));
const origin = (process.env.ORIGIN || "http://localhost:3290").replace(/\/$/, "");
assert.ok(["localhost", "fosscord.localhost", "127.0.0.1"].includes(new URL(origin).hostname));
const executablePath = browserName === "chromium" ? chromiumPath() : browserName === "firefox" ? process.env.FIREFOX_PATH : undefined;
const browser = await playwright[browserName].launch({
    ...(executablePath ? { executablePath } : {}),
    headless: true,
});
try {
    const page = await browser.newPage();
    const errors = [];
    let resizeObserverNotifications = 0;
    page.on("pageerror", (error) => {
        if (error.message === "ResizeObserver loop completed with undelivered notifications.") resizeObserverNotifications++;
        else if (!error.message.includes("Sentry successfully disabled")) errors.push(error.message);
    });
    await page.goto(`${origin}/login`);
    await page.locator('input[name="email"]').waitFor();
    const cancellations = await page.locator('input[name="email"]').evaluate((input) => {
        const callbacks = [];
        let fiber = input[Object.keys(input).find((key) => key.startsWith("__reactFiber$"))];
        for (; fiber; fiber = fiber.return) {
            let hook = fiber.memoizedState;
            let hops = 0;
            for (; hook && hops++ < 100; hook = hook.next) {
                const state = hook.memoizedState;
                for (const callback of [state, ...(Array.isArray(state) ? state : []), state?.create]) {
                    if (typeof callback === "function" && String(callback).includes(".abort(")) callbacks.push(String(callback));
                }
            }
        }
        return callbacks.map((source) => ({
            nativeAbort: /\.abort\(\)/.test(source),
            explicitReason: /\.abort\("/.test(source),
        }));
    });
    assert.equal(cancellations.length, 3, "The reset, password login and authenticated transition callbacks all cancel passkey mediation");
    assert.ok(
        cancellations.every(({ nativeAbort, explicitReason }) => nativeAbort && !explicitReason),
        "All three callbacks produce native AbortError cancellation",
    );
    await page.waitForTimeout(1000);
    await page.getByText("Register", { exact: true }).click();
    await page.waitForURL("**/register");
    await page.locator("cap-widget[required]").waitFor();
    await page.waitForTimeout(1000);
    assert.deepEqual(errors, [], "Cancelling conditional passkey sign-in produces no unhandled rejection");
    const compressed = await page.evaluate(
        () =>
            new Promise((resolve, reject) => {
                const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/?encoding=json&v=9&compress=zlib-stream`);
                socket.binaryType = "arraybuffer";
                const timer = setTimeout(() => {
                    socket.close();
                    reject(new Error("Gateway HELLO timed out"));
                }, 5000);
                socket.onmessage = (event) => {
                    clearTimeout(timer);
                    socket.close();
                    resolve(Array.from(new Uint8Array(event.data)));
                };
                socket.onerror = () => {
                    clearTimeout(timer);
                    reject(new Error("Browser gateway WebSocket failed"));
                };
            }),
    );
    const hello = JSON.parse(inflateSync(Buffer.from(compressed), { finishFlush: constants.Z_SYNC_FLUSH }).toString());
    assert.equal(hello.op, 10);
    assert.ok(hello.d.heartbeat_interval > 0);
    console.log(
        JSON.stringify({
            status: "pass",
            browser: browserName,
            passkeyCancellation: true,
            patchedCancellationReasons: 3,
            compressedGatewayHello: 10,
            unexpectedPageErrors: 0,
            resizeObserverNotifications,
        }),
    );
} finally {
    await browser.close();
}
