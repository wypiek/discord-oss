import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { inflateSync, constants } from "node:zlib";
import { chromiumPath } from "../util/chromium.cjs";

const { chromium } = createRequire(path.join(homedir(), ".cache/fosscord-tools/package.json"))("playwright-core");
const port = process.env.PORT || "3290";
const browser = await chromium.launch({
    headless: true,
    executablePath: chromiumPath(),
});
try {
    for (const host of [`localhost:${port}`, `fosscord.localhost:${port}`]) {
        const page = await browser.newPage();
        await page.goto(`http://${host}/login`);
        await page.locator('input[name="email"]').waitFor();
        const result = await page.evaluate(() => {
            const gateway = `ws://${location.host}`;
            return {
                host: location.host,
                cdn: window.GLOBAL_ENV.CDN_HOST,
                media: window.GLOBAL_ENV.MEDIA_PROXY_ENDPOINT,
                gateway,
                initial: window.GLOBAL_ENV.GATEWAY_ENDPOINT,
                alternate: window.GLOBAL_ENV.GATEWAY_ALT_ENDPOINT,
                resume: Vencord.Plugins.plugins.Fosscord.gateway(),
            };
        });
        assert.equal(result.cdn, result.host);
        assert.equal(result.media, `//${result.host}`);
        assert.equal(result.initial, result.gateway);
        assert.equal(result.alternate, result.gateway);
        assert.equal(result.resume, result.gateway);
        const bytes = await page.evaluate(
            () =>
                new Promise((resolve, reject) => {
                    const socket = new WebSocket(`${window.GLOBAL_ENV.GATEWAY_ENDPOINT}/?encoding=json&v=9&compress=zlib-stream`);
                    socket.binaryType = "arraybuffer";
                    const timer = setTimeout(() => {
                        socket.close();
                        reject(new Error("Gateway HELLO timeout"));
                    }, 5000);
                    socket.onmessage = (event) => {
                        clearTimeout(timer);
                        socket.close();
                        resolve(Array.from(new Uint8Array(event.data)));
                    };
                    socket.onerror = () => {
                        clearTimeout(timer);
                        reject(new Error("Gateway connect failed"));
                    };
                }),
        );
        assert.equal(JSON.parse(inflateSync(Buffer.from(bytes), { finishFlush: constants.Z_SYNC_FLUSH }).toString()).op, 10);
        console.log(`PASS CDN, media, initial, alternate and reconnect use ${host}; compressed HELLO received`);
        await page.close();
    }
} finally {
    await browser.close();
}
