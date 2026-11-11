const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync("assets/client_patches/70-local-cdn.js", "utf8");
function harness(origin = "https://meowcord.example:8443") {
    const location = new URL(origin);
    class Element {
        setAttribute(name, value) {
            this[name + "Attribute"] = value;
        }
    }
    class HTMLAnchorElement extends Element {}
    class HTMLImageElement extends Element {}
    class HTMLMediaElement extends Element {}
    class HTMLSourceElement extends Element {}
    class HTMLVideoElement extends HTMLMediaElement {}
    class CSSStyleDeclaration {
        setProperty(name, value) {
            this[name] = value;
        }
    }
    for (const [type, prop] of [
        [HTMLAnchorElement, "href"],
        [HTMLImageElement, "src"],
        [HTMLMediaElement, "src"],
        [HTMLSourceElement, "src"],
        [HTMLVideoElement, "poster"],
    ]) {
        Object.defineProperty(type.prototype, prop, {
            configurable: true,
            get() {
                return this["_" + prop];
            },
            set(v) {
                this["_" + prop] = v;
            },
        });
    }
    for (const prop of ["background", "backgroundImage", "maskImage", "webkitMaskImage", "content"])
        Object.defineProperty(CSSStyleDeclaration.prototype, prop, {
            configurable: true,
            get() {
                return this["_" + prop];
            },
            set(v) {
                this["_" + prop] = v;
            },
        });
    class XMLHttpRequest {
        open(method, url) {
            this.url = url;
        }
    }
    const window = {
        GLOBAL_ENV: { CDN_HOST: "localhost:3290" },
        fetch: (input, init) => ({ input, init }),
        open: (url) => url,
    };
    vm.runInNewContext(source, {
        location,
        window,
        Element,
        HTMLAnchorElement,
        HTMLImageElement,
        HTMLMediaElement,
        HTMLSourceElement,
        HTMLVideoElement,
        CSSStyleDeclaration,
        XMLHttpRequest,
        URL,
        Request,
    });
    assert.equal(window.GLOBAL_ENV.CDN_HOST, location.host);
    assert.equal(window.GLOBAL_ENV.MEDIA_PROXY_ENDPOINT, `//${location.host}`);
    assert.equal(window.GLOBAL_ENV.ASSET_ENDPOINT, `//${location.host}`);
    return { window, HTMLImageElement, CSSStyleDeclaration, XMLHttpRequest };
}
test("loopback clan badges follow current host, scheme and port at DOM/CSS/network boundaries", () => {
    for (const origin of ["http://localhost:3290", "http://fosscord.localhost:3290", "https://meowcord.example:8443", "http://[::1]:3290"]) {
        const h = harness(origin);
        for (const host of ["localhost:3290", "127.0.0.1:3290", "[::1]:3290", "0.0.0.0:3290", "fosscord.localhost:3290"]) {
            const bad = `https://${host}/clan-badges/123/hash.png?size=16#preview`;
            const expected = `${origin}/clan-badges/123/hash.png?size=16#preview`;
            const image = new h.HTMLImageElement();
            image.src = bad;
            assert.equal(image.src, expected);
            image.setAttribute("src", bad);
            assert.equal(image.srcAttribute, expected);
            const css = new h.CSSStyleDeclaration();
            css.backgroundImage = `url("${bad}")`;
            assert.equal(css.backgroundImage, `url("${expected}")`);
            css.setProperty("--image", `url(${bad})`);
            assert.equal(css["--image"], `url(${expected})`);
            assert.equal(h.window.fetch(bad).input, expected);
            assert.equal(h.window.fetch(new URL(bad)).input, expected);
            const req = new Request(bad, { headers: { "x-fixture": "preserved" } });
            const transformed = h.window.fetch(req).input;
            assert.equal(transformed.url, expected);
            assert.equal(transformed.headers.get("x-fixture"), "preserved");
            const xhr = new h.XMLHttpRequest();
            xhr.open("GET", bad);
            assert.equal(xhr.url, expected);
        }
    }
});
test("same-host wrong scheme and upstream art normalize while unrelated links remain unchanged", () => {
    const h = harness("http://meowcord.example:8080");
    assert.equal(h.window.fetch("https://meowcord.example:8080/avatars/123/hash.png").input, "http://meowcord.example:8080/avatars/123/hash.png");
    assert.equal(h.window.fetch("https://cdn.discordapp.com/badge-icons/hash.png").input, "http://meowcord.example:8080/badge-icons/hash.png");
    for (const value of [
        "https://external.example/avatars/123/hash.png",
        "http://localhost:3000/unrelated-service",
        "https://localhost.evil.example/clan-badges/a.png",
        "https://name:password@localhost:3290/assets/x.js",
        "data:image/png;base64,AA==",
        "/clan-badges/a.png",
    ])
        assert.equal(h.window.fetch(value).input, value);
});
test("bundled environment cannot advertise a configured loopback CDN", () => {
    assert.ok(!fs.readFileSync("src/bundle/TestClient.ts", "utf8").includes("cdn.endpointPublic"));
    const source = fs.readFileSync("src/bundle/ClientHtml.ts", "utf8");
    assert.ok(!source.includes("cdn.endpointPublic"));
    assert.match(source, /const host = location\.host;/);
    assert.match(source, /const cdn = host;/);
    assert.match(source, /CDN_HOST: cdn/);
    assert.match(source, /MEDIA_PROXY_ENDPOINT:.*cdn/);
});
