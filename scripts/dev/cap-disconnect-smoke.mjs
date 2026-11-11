import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { createRequire } from "node:module";
import { connect } from "node:net";
import { homedir } from "node:os";
import path from "node:path";
import { chromiumPath } from "../util/chromium.cjs";

const target = new URL(process.env.ORIGIN || `http://127.0.0.1:${process.env.PORT || 3001}`);
assert.equal(target.protocol, "http:");
assert.ok(["localhost", "127.0.0.1", "fosscord.localhost"].includes(target.hostname), "Use an isolated localhost instance");
const playwright = createRequire(path.join(homedir(), ".cache/fosscord-tools/package.json"))("playwright-core");
const browserName = process.env.BROWSER || "chromium";
assert.ok(["chromium", "webkit"].includes(browserName));
const staged = process.env.VENCORD_OUTPUT;
const sockets = new Set();
const upstreamRequests = new Set();
const errors = [];
const pageErrors = [];
let mode = "pass";
let forwarded = 0;
let attempts = 0;
let created;

const proxy = createServer((req, res) => {
    const url = new URL(req.url, target);
    if (url.origin !== target.origin) {
        res.writeHead(400);
        res.end();
        return;
    }
    const pathname = url.pathname;
    if (staged && ["/assets/vencord/vencord.js", "/assets/vencord/vencord.css"].includes(pathname)) {
        const file = path.join(staged, path.basename(pathname));
        res.writeHead(200, {
            "content-type": pathname.endsWith(".js") ? "application/javascript" : "text/css",
        });
        res.end(readFileSync(file));
        return;
    }
    const registering = req.method === "POST" && pathname.endsWith("/auth/register");
    if (registering) {
        attempts++;
        if (mode === "before") {
            res.destroy();
            return;
        }
        forwarded++;
    }
    const outgoing = httpRequest(
        new URL(req.url, target),
        {
            method: req.method,
            headers: {
                ...req.headers,
                host: target.host,
                ...(registering && mode === "after" ? { "accept-encoding": "identity" } : {}),
            },
        },
        (incoming) => {
            if (registering && mode === "after") {
                const parts = [];
                let bytes = 0;
                incoming.on("data", (chunk) => {
                    bytes += chunk.length;
                    if (bytes > 16384) incoming.destroy(new Error("Unexpected registration response size"));
                    else parts.push(chunk);
                });
                incoming.on("end", () => {
                    if (incoming.statusCode === 200) created = JSON.parse(Buffer.concat(parts).toString());
                    res.destroy();
                });
                incoming.on("error", (error) => {
                    errors.push(error.message);
                    res.destroy();
                });
                return;
            }
            res.writeHead(incoming.statusCode, incoming.headers);
            incoming.pipe(res);
            incoming.on("error", (error) => {
                errors.push(error.message);
                res.destroy();
            });
        },
    );
    upstreamRequests.add(outgoing);
    outgoing.on("close", () => upstreamRequests.delete(outgoing));
    outgoing.on("error", (error) => {
        errors.push(error.message);
        res.destroy();
    });
    req.pipe(outgoing);
});
proxy.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
});
proxy.on("upgrade", (req, socket, head) => {
    const upstream = connect(Number(target.port || 80), target.hostname, () => {
        const headers = Object.entries(req.headers)
            .map(([key, value]) => `${key}: ${value}`)
            .join("\r\n");
        upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${headers}\r\n\r\n`);
        if (head.length) upstream.write(head);
        socket.pipe(upstream);
        upstream.pipe(socket);
    });
    sockets.add(upstream);
    upstream.on("close", () => {
        sockets.delete(upstream);
        socket.destroy();
    });
    upstream.on("error", () => socket.destroy());
    socket.on("close", () => upstream.destroy());
    socket.on("error", () => upstream.destroy());
});
await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${proxy.address().port}`;
let browser;
const contextOptions = browserName === "webkit" ? playwright.devices["iPhone 13"] : {};
const self = async (token) => {
    assert.ok(typeof token === "string" && token.length > 0);
    const response = await fetch(new URL("/api/v9/users/@me", target), {
        headers: { authorization: token },
    });
    assert.equal(response.status, 200);
    return response.json();
};
const signupResponse = (page) =>
    page
        .waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/auth/register"))
        .then(async (response) => ({ status: response.status(), body: await response.json() }));
const prepare = async (page, username, password) => {
    await page.goto(`${origin}/register`);
    await page.locator("cap-widget[required]").waitFor();
    await page.evaluate(() => {
        const api = Vencord.Webpack.Common.RestAPI;
        const post = api.post;
        api.post = function (options) {
            const request = post.call(this, options);
            if (options.url.endsWith("/auth/register"))
                void request.then(
                    (response) => {
                        window.__ownedRegistrationResult = {
                            status: response.status,
                            hasBody: !!response.body,
                            hasToken: typeof response.body?.token === "string",
                        };
                    },
                    (error) => {
                        window.__ownedRegistrationResult = {
                            status: error?.status,
                            hasStatus: error && typeof error === "object" && "status" in error,
                            name: error?.name,
                        };
                    },
                );
            return request;
        };
    });
    await page.locator('input[name="global_name"]').fill("Owned disconnect fixture");
    await page.locator('input[name="username"]').fill(username);
    await page.locator('input[name="password"]').fill(password);
};
const solve = async (page) => {
    await page.locator("cap-widget").getByRole("button", { name: "Click to verify you're a human" }).click();
    await page.getByText("Verified. You can create your account.", { exact: true }).waitFor({ timeout: 60000 });
};
const interrupted = async (page, username, password) => {
    try {
        await page.locator(".fosscord-cap-recovery [role=alert]").waitFor();
    } catch (error) {
        console.log(
            JSON.stringify({
                phase: mode,
                attempts,
                forwarded,
                created: !!created,
                result: await page.evaluate(() => window.__ownedRegistrationResult),
            }),
        );
        throw error;
    }
    assert.match(await page.locator(".fosscord-cap-recovery").innerText(), /Your account may already exist/);
    assert.ok((await page.locator('input[name="username"]').inputValue()) === username, "Username draft remains intact");
    assert.ok((await page.locator('input[name="password"]').inputValue()) === password, "Password draft remains intact");
    assert.equal(await page.locator(".fosscord-cap-recovery a").getAttribute("href"), "/login");
    assert.equal(await page.evaluate(() => !!Vencord.Plugins.plugins.FosscordCap.takeToken()), false);
    const before = attempts;
    await page.getByRole("button", { name: "Create Account", exact: true }).click();
    await page.waitForTimeout(350);
    assert.equal(attempts, before, "Unknown proof cannot start another registration");
    assert.doesNotMatch(await page.locator("body").innerText(), /probably your fault/i);
    const link = page.locator(".fosscord-cap-recovery a");
    await page.keyboard.press("Tab");
    await link.focus();
    assert.equal(await link.evaluate((element) => element.matches(":focus-visible")), true);
    assert.ok((await link.boundingBox()).height >= (browserName === "webkit" ? 44 : 40));
};

try {
    browser = await playwright[browserName].launch(
        browserName === "chromium"
            ? {
                  executablePath: chromiumPath(),
                  headless: true,
              }
            : { headless: true },
    );
    const firstContext = await browser.newContext(contextOptions);
    const first = await firstContext.newPage();
    first.on("pageerror", (error) => {
        if (!error.message.includes("Sentry successfully disabled")) pageErrors.push(error.message);
    });
    const username = `capdisconnect${Date.now()}`;
    const password = `${crypto.randomUUID()}A9`;
    await prepare(first, username, password);
    await solve(first);
    mode = "before";
    await first.getByRole("button", { name: "Create Account", exact: true }).click();
    await interrupted(first, username, password);
    assert.equal(forwarded, 0, "Failure before forwarding creates no account");
    if (process.env.CAP_DISCONNECT_SCREENSHOT) await first.screenshot({ path: process.env.CAP_DISCONNECT_SCREENSHOT, fullPage: true });
    mode = "pass";
    await solve(first);
    const retried = signupResponse(first);
    await first.getByRole("button", { name: "Create Account", exact: true }).click();
    const registered = await retried;
    assert.equal(registered.status, 200);
    assert.equal((await self(registered.body.token)).username, username);
    await firstContext.close();

    const secondContext = await browser.newContext(contextOptions);
    const second = await secondContext.newPage();
    second.on("pageerror", (error) => {
        if (!error.message.includes("Sentry successfully disabled")) pageErrors.push(error.message);
    });
    const secondUsername = `capresponse${Date.now()}`;
    const secondPassword = `${crypto.randomUUID()}A9`;
    await prepare(second, secondUsername, secondPassword);
    await solve(second);
    mode = "after";
    await second.getByRole("button", { name: "Create Account", exact: true }).click();
    await interrupted(second, secondUsername, secondPassword);
    assert.ok(created, "Server created the account before the response was discarded");
    const account = await self(created.token);
    assert.equal(account.username, secondUsername);
    const beforeSignin = attempts;
    mode = "pass";
    await second.getByRole("link", { name: "Sign in", exact: true }).click();
    await second.locator('input[name="email"]').waitFor();
    await second.locator('input[name="email"]').fill(secondUsername);
    await second.locator('input[name="password"]').fill(secondPassword);
    const signedIn = second
        .waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/auth/login"))
        .then(async (response) => ({ status: response.status(), body: await response.json() }));
    await second.getByRole("button", { name: "Log In", exact: true }).click();
    const login = await signedIn;
    assert.equal(login.status, 200);
    assert.equal((await self(login.body.token)).id, account.id);
    assert.equal(attempts, beforeSignin, "Signin recovery sends no further registration");
    await secondContext.close();
    assert.deepEqual(errors, []);
    assert.deepEqual(pageErrors, []);
    console.log(
        JSON.stringify({
            browser: browserName,
            realHttpDisconnectBeforeForwarding: true,
            nativeRetrySignup: 200,
            realResponseLostAfterCreation: true,
            nativeSigninRecoveredSameAccount: true,
            originalPasswordsUsed: true,
            staleProofBlocked: true,
            draftsRetained: true,
            focusedSigninLink: true,
            loginRecoveryCreatesNoFurtherAccount: true,
        }),
    );
} finally {
    await browser?.close();
    for (const outgoing of upstreamRequests) outgoing.destroy();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => proxy.close(resolve));
}
