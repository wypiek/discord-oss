import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { chromiumPath } from "../util/chromium.cjs";
const playwright = createRequire(path.join(homedir(), ".cache/fosscord-tools/package.json"))("playwright-core");
const origin = process.env.ORIGIN || `http://localhost:${process.env.PORT || 3413}`;
assert.ok(["localhost", "127.0.0.1", "fosscord.localhost"].includes(new URL(origin).hostname));
assert.ok(process.env.TEST_ACCOUNT_PATH);
const account = Object.fromEntries(
    readFileSync(process.env.TEST_ACCOUNT_PATH, "utf8")
        .trim()
        .split("\n")
        .map((line) => {
            const at = line.indexOf("=");
            return [line.slice(0, at), line.slice(at + 1)];
        }),
);
const call = async (method, pathname, token, body) => {
    const response = await fetch(`${origin}/api/v9${pathname}`, {
        method,
        headers: {
            ...(token && { authorization: token }),
            ...(body && { "content-type": "application/json" }),
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => null);
    return { status: response.status, data };
};
const login = await call("POST", "/auth/login", null, {
    login: account.TEST_EMAIL,
    password: account.TEST_PASSWORD,
});
assert.equal(login.status, 200);
assert.ok(login.data?.token);
const token = login.data.token;
const failureMode = process.env.SEND_FAILURE_MODE || "slowmode";
assert.ok(["slowmode", "unavailable"].includes(failureMode));
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
const NativeWebSocket = (await import("ws")).default;
const transport = { opened: 0, upstreamOpened: 0, clientFrames: 0, serverFrames: 0, errors: 0 };
const failedResponses = [];
let page;
let rejectionPath;
let preempted = false;
const proxy = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request, server) => {
        const url = new URL(request.url);
        if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
            if (
                server.upgrade(request, {
                    data: {
                        pathname: url.pathname + url.search,
                        userAgent: request.headers.get("user-agent"),
                        cookie: request.headers.get("cookie"),
                        origin: request.headers.get("origin"),
                        pending: [],
                        upstream: null,
                    },
                })
            )
                return;
            return new Response(null, { status: 400 });
        }
        if (request.method === "POST" && url.pathname === rejectionPath && !preempted) {
            preempted = true;
            assert.equal(
                (
                    await call("POST", rejectionPath.replace("/api/v9", ""), token, {
                        content: "Competing successful send",
                    })
                ).status,
                200,
            );
            if (failureMode === "unavailable")
                return new Response(JSON.stringify({ code: 0, message: "Injected native send failure" }), {
                    status: 503,
                    headers: { "content-type": "application/json" },
                });
        }
        const response = await fetch(new URL(url.pathname + url.search, origin), {
            method: request.method,
            headers: request.headers,
            body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer(),
            redirect: "manual",
        });
        if (response.status >= 400) failedResponses.push({ status: response.status, path: url.pathname });
        const headers = new Headers(response.headers);
        headers.delete("content-encoding");
        headers.delete("content-length");
        return new Response(response.body, { status: response.status, headers });
    },
    websocket: {
        open: (socket) => {
            transport.opened++;
            const upstream = new NativeWebSocket(origin.replace(/^http/, "ws") + socket.data.pathname, {
                headers: {
                    origin: socket.data.origin || origin,
                    "user-agent": socket.data.userAgent,
                    ...(socket.data.cookie && { cookie: socket.data.cookie }),
                },
            });
            socket.data.upstream = upstream;
            upstream.on("open", () => {
                transport.upstreamOpened++;
                for (const message of socket.data.pending) upstream.send(message);
                socket.data.pending = [];
            });
            upstream.on("message", (message, binary) => {
                transport.serverFrames++;
                socket.send(binary ? message : message.toString());
            });
            upstream.on("close", () => socket.close());
            upstream.on("error", () => {
                transport.errors++;
                socket.close();
            });
        },
        message: (socket, message) => {
            transport.clientFrames++;
            if (socket.data.upstream?.readyState === NativeWebSocket.OPEN) socket.data.upstream.send(message);
            else socket.data.pending.push(message);
        },
        close: (socket) => socket.data.upstream?.close(),
    },
});
const clientOrigin = `http://127.0.0.1:${proxy.port}`;
let guildId;
let phase = "setup";
try {
    const guild = await call("POST", "/guilds", token, {
        name: `slowmode-client-${browserName}-${Date.now()}`,
    });
    assert.equal(guild.status, 201);
    guildId = guild.data.id;
    const channels = await call("GET", `/guilds/${guildId}/channels`, token);
    const channel = channels.data.find((channel) => channel.type === 0);
    assert.ok(channel);
    assert.equal((await call("PATCH", `/channels/${channel.id}`, token, { rate_limit_per_user: 5 })).status, 200);
    const context = await browser.newContext();
    await context.addInitScript(() => {
        window.slowmodeRejections = [];
        window.addEventListener("unhandledrejection", (event) => {
            const reason = event.reason;
            const number = (values, minimum, maximum) => values.find((value) => Number.isInteger(value) && value >= minimum && value <= maximum) ?? null;
            window.slowmodeRejections.push({
                status: number([reason?.status, reason?.statusCode, reason?.httpStatus, reason?.response?.status], 100, 599),
                code: number([reason?.code, reason?.body?.code, reason?.response?.body?.code, reason?.response?.data?.code], 0, 1000000),
                keys:
                    reason && typeof reason === "object"
                        ? Object.keys(reason).filter((key) => ["status", "statusCode", "httpStatus", "code", "body", "response", "message"].includes(key))
                        : [],
            });
        });
    });
    await context.addInitScript((token) => localStorage.setItem("token", JSON.stringify(token)), token);
    page = await context.newPage();
    const errors = [];
    const errorPhases = [];
    page.on("pageerror", (error) => {
        errors.push(error.message);
        errorPhases.push({
            phase,
            sentryDisabled: error.message.includes("Sentry successfully disabled"),
        });
    });
    phase = "compose";
    await page.goto(`${clientOrigin}/channels/${guildId}/${channel.id}`);
    const composer = page.locator("[role=textbox][contenteditable=true]");
    await composer.waitFor({ timeout: 45000 });
    await composer.fill("First native slowmode message");
    const response = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api/v9/channels/${channel.id}/messages`);
    await composer.press("Enter");
    assert.equal((await response).status(), 200);
    await composer.fill("Retained native draft");
    const countdown = page.getByText(/^0:0[0-5]$/);
    await countdown.waitFor();
    let writes = 0;
    page.on("request", (request) => {
        if (request.method() === "POST" && new URL(request.url()).pathname === `/api/v9/channels/${channel.id}/messages`) writes++;
    });
    await composer.press("Enter");
    await page.waitForTimeout(250);
    assert.equal(writes, 0, "Cooldown must block the next network send");
    assert.equal(await composer.innerText(), "Retained native draft");
    await countdown.waitFor({ state: "hidden", timeout: 12000 });
    phase = "expiry";
    const secondResponse = page.waitForResponse(
        (response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api/v9/channels/${channel.id}/messages`,
    );
    await composer.press("Enter");
    assert.equal((await secondResponse).status(), 200);
    const persisted = await call("GET", `/channels/${channel.id}/messages`, token);
    assert.equal(persisted.status, 200);
    assert.equal(persisted.data.length, 2);
    assert.equal(persisted.data.filter((message) => message.content === "Retained native draft").length, 1);
    const initialRejections = await page.evaluate(() => window.slowmodeRejections);
    phase = "rejection";
    const created = await call("POST", `/guilds/${guildId}/channels`, token, {
        name: "server-rejection",
        type: 0,
        rate_limit_per_user: 5,
    });
    assert.equal(created.status, 201);
    const rejectedId = created.data.id;
    rejectionPath = `/api/v9/channels/${rejectedId}/messages`;
    await page.goto(`${clientOrigin}/channels/${guildId}/${rejectedId}`);
    await composer.waitFor({ timeout: 45000 });
    await composer.fill("Retained rejected message");
    const rejectedResponse = page.waitForResponse(
        (response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api/v9/channels/${rejectedId}/messages`,
    );
    await composer.press("Enter");
    const rejected = await rejectedResponse;
    assert.equal(preempted, true, "The competing send must run before the intercepted request");
    assert.equal(rejected.status(), failureMode === "slowmode" ? 429 : 503);
    const rejection = await rejected.json();
    assert.equal(rejection.code, failureMode === "slowmode" ? 20016 : 0);
    if (failureMode === "slowmode") assert.ok(rejection.retry_after > 0 && rejection.retry_after <= 5);
    await page.getByText("Retained rejected message", { exact: true }).waitFor();
    const duringRejection = await call("GET", `/channels/${rejectedId}/messages`, token);
    assert.equal(duringRejection.status, 200);
    assert.equal(duringRejection.data.length, 1);
    assert.equal(duringRejection.data[0].content, "Competing successful send");
    await composer.fill("Draft while retry is pending");
    await page.waitForTimeout(5500);
    await page.getByText("Retained rejected message", { exact: true }).click({ button: "right" });
    const retryResponse = page.waitForResponse(
        (response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api/v9/channels/${rejectedId}/messages`,
        { timeout: 10000 },
    );
    await page.getByRole("menuitem", { name: "Resend message", exact: true }).click();
    assert.equal((await retryResponse).status(), 200);
    const afterRetry = await call("GET", `/channels/${rejectedId}/messages`, token);
    assert.equal(afterRetry.status, 200);
    assert.equal(afterRetry.data.length, 2);
    assert.equal(afterRetry.data.filter((message) => message.content === "Retained rejected message").length, 1);
    assert.equal(await composer.innerText(), "Draft while retry is pending");
    const unhandledRejections = [...initialRejections, ...(await page.evaluate(() => window.slowmodeRejections))];
    assert.deepEqual(unhandledRejections, failureMode === "slowmode" ? [] : [{ status: 503, code: 0, keys: ["body", "status"] }]);
    console.log(
        JSON.stringify({
            browser: browserName,
            userClass: "owner",
            countdownDraftPassed: true,
            realSlowmodeRejection: failureMode === "slowmode",
            otherSendFailurePreserved: failureMode === "unavailable",
            rejectedMessageRetained: true,
            manualRetryPersistedOnce: true,
            newerDraftRetained: true,
            clientPageErrorCount: errors.length,
            sentryDisabledErrorCount: errors.filter((message) => message.includes("Sentry successfully disabled")).length,
            otherClientErrorCount: errors.filter((message) => !message.includes("Sentry successfully disabled")).length,
            otherClientErrors: errors
                .filter((message) => !message.includes("Sentry successfully disabled"))
                .map((message) =>
                    /token|password|secret|authorization/i.test(message)
                        ? "credential-related error"
                        : message
                              .replace(/(?:https?|wss?):\/\/\S+/g, "[url]")
                              .replace(/[A-Za-z0-9_-]{16,}/g, "[redacted]")
                              .slice(0, 180),
                ),
            serviceWorkersEnabled: true,
            errorPhases,
            unhandledRejections,
        }),
    );
} catch (error) {
    console.error(
        JSON.stringify({
            browser: browserName,
            phase,
            transport,
            failedResponses: failedResponses.slice(-10),
        }),
    );
    throw error;
} finally {
    try {
        if (guildId) assert.equal((await call("POST", `/guilds/${guildId}/delete`, token, {})).status, 204);
    } finally {
        try {
            await browser.close();
        } finally {
            proxy.stop(true);
        }
    }
}
