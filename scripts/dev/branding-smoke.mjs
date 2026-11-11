import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createRequire } from "node:module";
import { chromiumPath } from "../util/chromium.cjs";
const { chromium, webkit } = createRequire(path.join(os.homedir(), ".cache/fosscord-tools/package.json"))("playwright-core");
const kind = process.env.BROWSER || "chromium",
    origin = (process.env.ORIGIN || "http://localhost:3290").replace(/\/$/, "");
assert.ok(["chromium", "webkit"].includes(kind));
assert.ok(["localhost", "fosscord.localhost", "127.0.0.1"].includes(new URL(origin).hostname));
const root = path.resolve(import.meta.dirname, "../..");
const b = await { chromium, webkit }[kind].launch(kind === "chromium" ? { executablePath: chromiumPath() } : {});
try {
    const p = await b.newPage({ viewport: { width: 1000, height: 750 } });
    const errors = [];
    p.on("pageerror", (e) => {
        if (!e.message.includes("Sentry successfully disabled") && !e.message.includes("ResizeObserver loop")) errors.push(e.message);
    });
    await p.addInitScript(() => {
        window.nativeBrandSpinnerSeen = false;
        new MutationObserver(() => {
            if (document.querySelector(".meowcord-spinner")) window.nativeBrandSpinnerSeen = true;
        }).observe(document, { childList: true, subtree: true });
    });
    await p.goto(origin + "/login");
    await p.locator('input[name="email"]').waitFor();
    await p.screenshot({ path: `/tmp/fosscord-meowcord-login-${kind}.png` });
    assert.equal(await p.locator('link[rel="icon"]').getAttribute("href"), "/favicon.svg");
    let favicon = await p.request.get(origin + "/favicon.svg");
    assert.equal(favicon.status(), 200);
    assert.equal(await favicon.text(), fs.readFileSync(path.join(root, "assets/public/branding/favicon.svg"), "utf8"));
    for (const size of [180, 192, 512]) {
        const r = await p.request.get(`${origin}/assets/pwa/icon-${size}.png`);
        assert.equal(r.status(), 200);
        assert.match(r.headers()["content-type"], /image\/png/);
        const png = await r.body();
        const metadata = await sharp(png).metadata();
        assert.equal(metadata.width, size);
        assert.equal(metadata.height, size);
        if (size === 512) {
            const actualPixels = await sharp(png).ensureAlpha().raw().toBuffer();
            const referencePixels = await sharp(path.join(root, "assets/public/branding/meowcord-icon.svg")).ensureAlpha().raw().toBuffer();
            assert.deepEqual(actualPixels, referencePixels);
        }
        fs.writeFileSync(path.join(os.tmpdir(), `fosscord-meowcord-pwa-${size}.png`), png);
    }
    const nativeSpinnerSeen = await p.evaluate(() => window.nativeBrandSpinnerSeen);
    const avatars = await p.evaluate(() => Vencord.Plugins.plugins.FosscordBranding.defaultAvatars());
    for (const url of avatars) {
        assert.ok(["localhost", "fosscord.localhost", "127.0.0.1"].includes(new URL(url).hostname));
        const response = await p.request.get(url);
        assert.equal(response.status(), 200);
        const { data, info } = await sharp(await response.body())
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
        assert.equal(info.width, 256);
        assert.equal(info.height, 256);
        const pixel = (x, y) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 3)];
        assert.deepEqual(pixel(128, 134), [255, 255, 255]);
        assert.deepEqual(pixel(105, 134), pixel(0, 0));
    }
    await p.evaluate(() => {
        const { React } = Vencord.Webpack.Common;
        const ReactDOM = Vencord.Webpack.findByProps("createRoot");
        const host = document.createElement("div");
        host.id = "brand-proof";
        host.style.cssText = "position:fixed;inset:0;background:#313338;--text-strong:#fff;z-index:99999";
        document.body.append(host);
        window.brandProofRoot = ReactDOM.createRoot(host);
        window.brandReady = 0;
        const original = React.createElement("div", { className: "proof-original" });
        window.brandProofRoot.render(Vencord.Plugins.plugins.FosscordLoading.animation(original, () => window.brandReady++));
    });
    await p.locator("#brand-proof .meowcord-spinner").waitFor();
    const actual = await p.locator("#brand-proof").evaluate((e) => ({
        paths: [...e.querySelectorAll("path")].map((p) => p.getAttribute("d")),
        css: e.querySelector("style").textContent,
        animations: e
            .querySelector("svg")
            .getAnimations({ subtree: true })
            .map((a) => ({ name: a.animationName, duration: a.effect.getTiming().duration })),
        ready: window.brandReady,
    }));
    const ref = fs.readFileSync(path.join(root, "assets/public/branding/spinner.html"), "utf8");
    assert.deepEqual(
        actual.paths,
        [...ref.matchAll(/<path[^>]* d="([^"]+)"/g)].map((m) => m[1]),
    );
    assert.equal(
        actual.css,
        ref
            .match(/<style>(.*?)<\/style>/)[1]
            .replace(".meowcord-spinner>svg,.meowcord-spinner path{animation:none}", ".meowcord-spinner>svg,.meowcord-spinner .wl,.meowcord-spinner .wr{animation:none}"),
    );
    assert.equal(actual.animations.length, 3);
    assert.ok(actual.animations.every((a) => a.duration === 1100));
    assert.equal(actual.ready, 1);
    await p.locator("#brand-proof svg").evaluate((e) => {
        for (const a of e.getAnimations({ subtree: true })) {
            a.pause();
            a.currentTime = 0;
        }
    });
    await p.screenshot({ path: `/tmp/fosscord-meowcord-spinner-${kind}.png` });
    await p.emulateMedia({ reducedMotion: "reduce" });
    await p.waitForFunction(() => document.querySelector("#brand-proof svg").getAnimations({ subtree: true }).length === 0);
    await p.evaluate(() => {
        GLOBAL_ENV.LOADING_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>';
        GLOBAL_ENV.LOADING_TIPS = ["custom instance tip"];
        window.brandProofRoot.render(Vencord.Plugins.plugins.FosscordLoading.animation(Vencord.Webpack.Common.React.createElement("div"), () => window.brandReady++));
    });
    await p.locator('#brand-proof img[alt="Loading"]').waitFor();
    assert.equal(await p.locator("#brand-proof .meowcord-spinner").count(), 0);
    assert.equal(await p.evaluate(() => Vencord.Plugins.plugins.FosscordLoading.tip()), "custom instance tip");
    assert.deepEqual(errors, []);
    console.log(
        JSON.stringify({
            status: "pass",
            browser: kind,
            archivePathsAndCSSExact: true,
            nativeSpinnerSeen,
            defaultAvatars: avatars.length,
            animations: actual.animations,
            reducedMotion: true,
            customSvgAndTips: true,
            faviconExact: true,
            pwaSizes: [180, 192, 512],
            unexpectedPageErrors: 0,
        }),
    );
} finally {
    await b.close();
}
