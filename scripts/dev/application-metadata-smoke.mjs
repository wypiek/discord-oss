import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { chromiumPath } from "../util/chromium.cjs";
const playwright = createRequire(path.join(homedir(), ".cache/fosscord-tools/package.json"))("playwright-core");
const origin = process.env.ORIGIN || `http://localhost:${process.env.PORT || 3413}`;
assert.ok(["localhost", "127.0.0.1", "fosscord.localhost"].includes(new URL(origin).hostname));
assert.ok(process.env.TEST_ACCOUNT_PATH, "Provide the isolated seeded account file");
const account = Object.fromEntries(
    readFileSync(process.env.TEST_ACCOUNT_PATH, "utf8")
        .trim()
        .split("\n")
        .map((line) => {
            const at = line.indexOf("=");
            return [line.slice(0, at), line.slice(at + 1)];
        }),
);
assert.ok(account.TEST_EMAIL && account.TEST_PASSWORD);
const browserName = process.env.BROWSER || "chromium";
assert.ok(["chromium", "webkit"].includes(browserName));
const database = process.env.APPLICATION_METADATA_TEST_DATABASE;
assert.match(database || "", /^meowcord_app_metadata_[0-9]+$/, "Use a freshly created isolated metadata-test database");
const sql = (query) => {
    const result = Bun.spawnSync(["psql", `postgres://localhost:5432/${database}`, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", query], { stdout: "pipe", stderr: "pipe" });
    assert.equal(result.exitCode, 0, "Fixture SQL must succeed");
    return Buffer.from(result.stdout).toString().trim();
};
assert.equal(sql("SELECT current_database()"), database);
const browser = await playwright[browserName].launch(
    browserName === "chromium"
        ? {
              executablePath: chromiumPath(),
              headless: true,
          }
        : { headless: true },
);
let page;
let applicationId;
let botId;
let constraintsAdded = false;
let phase = "signin";
const request = (method, pathname, body) =>
    page.evaluate(
        async ({ method, pathname, body }) => {
            const token = JSON.parse(localStorage.getItem("token"));
            const response = await fetch(`/api/v9${pathname}`, {
                method,
                headers: { authorization: token, "content-type": "application/json" },
                body: body === undefined ? undefined : JSON.stringify(body),
            });
            const text = await response.text();
            const value = text ? JSON.parse(text) : {};
            return {
                status: response.status,
                id: value.id,
                botId: value.bot?.id,
                description: value.description,
                bio: value.user?.bio,
            };
        },
        { method, pathname, body },
    );
try {
    const context = await browser.newContext();
    page = await context.newPage();
    const loginErrors = [];
    const errors = [];
    page.on("pageerror", (error) => loginErrors.push(error.message));
    await page.goto(`${origin}/login`);
    await page.locator('input[name="email"]').fill(account.TEST_EMAIL);
    await page.locator('input[name="password"]').fill(account.TEST_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL("**/channels/@me");
    assert.ok(await page.evaluate(() => localStorage.getItem("token")));
    await page.close();
    page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/developers/applications`);
    await page.getByRole("button", { name: "New application", exact: true }).waitFor();
    phase = "fixture-creation";
    const created = await request("POST", "/applications", { name: "app-metadata-probe" });
    assert.equal(created.status, 200);
    applicationId = created.id;
    assert.match(applicationId, /^\d+$/);
    const pathname = `/applications/${applicationId}`;
    assert.equal((await request("PATCH", pathname, { description: "original description" })).status, 200);
    const app = await request("GET", pathname);
    assert.equal(app.status, 200);
    botId = app.botId;
    assert.match(botId, /^\d+$/);
    assert.equal(
        sql(
            `SELECT count(*) FROM applications a JOIN users u ON u.id = a.bot_user_id WHERE a.id = '${applicationId}' AND a.name = 'app-metadata-probe' AND u.id = '${botId}' AND u.bot = true`,
        ),
        "1",
    );
    const profilePath = `/users/${botId}/profile`;
    const checkSaved = async (description) => {
        const app = await request("GET", pathname);
        const profile = await request("GET", profilePath);
        assert.equal(app.status, 200);
        assert.equal(profile.status, 200);
        assert.equal(app.description, description);
        assert.equal(profile.bio, description);
    };
    await checkSaved("original description");
    phase = "validation-rejections";
    for (const invalid of [
        { tags: ["x".repeat(21)] },
        { custom_install_url: "not-a-url" },
        { integration_types_config: {} },
        { terms_of_service_url: "not-a-url" },
        { privacy_policy_url: "not-a-url" },
    ]) {
        assert.equal((await request("PATCH", pathname, { description: "rejected description", ...invalid })).status, 400);
        await checkSaved("original description");
    }
    await Bun.sleep(10500);
    phase = "database-write-failures";
    sql(
        `BEGIN; ALTER TABLE applications ADD CONSTRAINT app_metadata_${applicationId} CHECK (id <> '${applicationId}' OR description <> 'fail-application-write'); ALTER TABLE users ADD CONSTRAINT bot_metadata_${botId} CHECK (id <> '${botId}' OR bio <> 'fail-bot-write'); COMMIT;`,
    );
    constraintsAdded = true;
    for (const description of ["fail-application-write", "fail-bot-write"]) {
        assert.equal((await request("PATCH", pathname, { description })).status, 500);
        await checkSaved("original description");
    }
    phase = "successful-retry-and-clearing";
    assert.equal((await request("PATCH", pathname, { description: "retry saved" })).status, 200);
    await checkSaved("retry saved");
    assert.equal((await request("PATCH", pathname, { name: "app-metadata-probe-renamed" })).status, 200);
    await checkSaved("retry saved");
    assert.equal((await request("PATCH", pathname, { description: "" })).status, 200);
    await checkSaved("");
    assert.deepEqual(errors, []);
    console.log(
        JSON.stringify({
            browser: browserName,
            nativeSignin: true,
            validationRejections: 5,
            persistenceFailures: 2,
            bothRowsUnchangedAfterRejection: true,
            failedBotWriteRollsBackApplication: true,
            retrySavesBothRows: true,
            omittedDescriptionPreserved: true,
            emptyDescriptionClearsBoth: true,
            portalPageErrors: errors.length,
            loginPageErrorCount: loginErrors.length,
        }),
    );
} catch (error) {
    console.error(JSON.stringify({ browser: browserName, phase }));
    throw error;
} finally {
    try {
        if (constraintsAdded)
            sql(`BEGIN; ALTER TABLE applications DROP CONSTRAINT app_metadata_${applicationId}; ALTER TABLE users DROP CONSTRAINT bot_metadata_${botId}; COMMIT;`);
        if (applicationId && page && !page.isClosed()) assert.equal((await request("POST", `/applications/${applicationId}/delete`, {})).status, 200);
    } finally {
        await browser.close();
    }
}
