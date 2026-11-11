const assert = require("node:assert/strict"),
    fs = require("node:fs");
const base = require("node:path").resolve(__dirname, "../../dist");
const acct = Object.fromEntries(
    fs
        .readFileSync(process.env.TEST_ACCOUNT_FILE || require("node:path").resolve(__dirname, ".test-account"), "utf8")
        .trim()
        .split("\n")
        .map((line) => {
            const p = line.indexOf("=");
            return [line.slice(0, p), line.slice(p + 1)];
        }),
);
const call = async (token, method, path, body) => {
    const r = await fetch("http://localhost:3290/api/v9" + path, {
        method,
        headers: { "content-type": "application/json", ...(token ? { authorization: token } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, data: r.status === 204 ? null : await r.json() };
};
const field = (value) => ({ value_type: "data", presentation_type: "text", value });
const surfaces = {
    widget_top: {
        layout: "widget_top_hero",
        components: { title: { fields: { text: field("score") } } },
    },
    widget_bottom: {
        layout: "widget_bottom_stats",
        components: { stat_1: { fields: { value: field("score") } } },
    },
    add_widget_preview: {
        layout: "add_widget_preview_hero",
        components: {
            hero_image: {
                fields: {
                    image: { value_type: "data", presentation_type: "image", value: "preview_asset" },
                },
            },
        },
    },
};
(async () => {
    assert.equal(new URL(process.env.DATABASE).pathname, "/fosscord_codex_admin");
    const e = require(base + "/database");
    const db = await e.initDatabase();
    let app, otherApp, original, user, admin;
    try {
        admin = (
            await call(null, "POST", "/auth/login", {
                login: acct.TEST_EMAIL,
                password: acct.TEST_PASSWORD,
            })
        ).data.token;
        const friend = (
            await call(null, "POST", "/auth/login", {
                login: "friend@fosscord.test",
                password: acct.FRIEND_PASSWORD,
            })
        ).data.token;
        assert.equal(typeof admin, "string");
        assert.equal(typeof friend, "string");
        user = await e.User.findOneOrFail({
            where: { email: acct.TEST_EMAIL },
            select: { id: true, profile_widgets: true },
        });
        original = user.profile_widgets;
        const created = await call(admin, "POST", "/applications", {
            name: "Disposable widget privacy smoke",
        });
        assert.equal(created.status, 200);
        app = created.data;
        const id = app.id,
            dataPath = `/applications/${id}/users/${user.id}/widget-data`;
        assert.equal((await call(admin, "PUT", `/applications/${id}/widget-config`, { surfaces, public: false })).status, 200);
        assert.equal(
            (
                await call(admin, "PUT", dataPath, {
                    username: "Disposable identity",
                    data: {
                        score: "Visible points",
                        internal_note: "Safe test marker",
                        preview_asset: "local-preview-marker",
                    },
                })
            ).status,
            200,
        );
        await e.User.update({ id: user.id }, { profile_widgets: [] });
        const hidden = await call(friend, "GET", `/users/${user.id}/application-identities`);
        assert.equal(hidden.status, 200);
        const hiddenVisible = hidden.data.identities.some((x) => x.application_id === id);
        assert.equal(
            (
                await call(admin, "PUT", "/users/@me/widgets", {
                    widgets: [{ data: { type: "application", application_id: id } }],
                })
            ).status,
            200,
        );
        const selected = await call(friend, "GET", `/users/${user.id}/application-identities`);
        const identity = selected.data.identities.find((x) => x.application_id === id);
        assert.ok(identity);
        const keys = identity.profile.data.dynamic.map((x) => x.name);
        const self = await call(admin, "GET", "/users/@me/application-identities");
        const own = self.data.identities.find((x) => x.application_id === id);
        assert.ok(own);
        const secondApp = await call(admin, "POST", "/applications", {
            name: "Disposable other widget application",
        });
        assert.equal(secondApp.status, 200);
        otherApp = secondApp.data;
        const botResponse = await call(admin, "POST", `/applications/${app.id}/bot/reset`, {});
        assert.equal(botResponse.status, 200);
        assert.equal(typeof botResponse.data.token, "string");
        const bot = await call("Bot " + botResponse.data.token, "PATCH", dataPath, {
            data: { score: "Updated by linked bot" },
        });
        const wrongBot = await call("Bot " + botResponse.data.token, "GET", `/applications/${otherApp.id}/users/${user.id}/widget-data`);
        const forbidden = await call(friend, "PUT", dataPath, { data: { score: "Denied" } });
        const full = await call(admin, "GET", dataPath);
        const anon = await call(null, "GET", `/users/${user.id}/application-identities`);
        const remoteImage = await call(admin, "POST", `/applications/${id}/widget-config/assets`, {
            image: "https://example.invalid/widget.png",
        });
        const png = await require("sharp")({
            create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
        })
            .png()
            .toBuffer();
        const localImage = await call(admin, "POST", `/applications/${id}/widget-config/assets`, {
            image: `data:image/png;base64,${png.toString("base64")}`,
        });
        const array = await call(admin, "PUT", dataPath, { data: ["bad"] }),
            string = await call(admin, "PATCH", dataPath, { data: "abc" }),
            nullBody = await call(admin, "PUT", dataPath, null);
        const summary = {
            fixed: process.env.EXPECT_WIDGET_FIX !== "0",
            hiddenIdentityExposed: hiddenVisible,
            publicKeys: keys,
            selfPreviewAvailable: own.profile.data.dynamic.some((x) => x.name === "preview_asset"),
            otherWriterStatus: forbidden.status,
            linkedBotStatus: bot.status,
            otherApplicationBotStatus: wrongBot.status,
            ownerFullPrivateData: full.data.data.internal_note === "Safe test marker",
            anonymousStatus: anon.status,
            remoteImageRejectedStatus: remoteImage.status,
            localImageUploadedStatus: localImage.status,
            invalidArrayStatus: array.status,
            invalidStringStatus: string.status,
            invalidNullBodyStatus: nullBody.status,
        };
        if (summary.fixed) {
            assert.equal(hiddenVisible, false);
            assert.deepEqual(keys, ["score"]);
            assert.equal(summary.selfPreviewAvailable, true);
            assert.equal(forbidden.status, 400);
            assert.equal(forbidden.data.code, 20012);
            assert.equal(summary.ownerFullPrivateData, true);
            assert.equal(bot.status, 200);
            assert.equal(wrongBot.status, 400);
            assert.equal(wrongBot.data.code, 20012);
            assert.equal(anon.status, 401);
            assert.equal(remoteImage.status, 400);
            assert.equal(localImage.status, 201);
            assert.equal(localImage.data.width, 1);
            assert.equal(localImage.data.height, 1);
            assert.equal(array.status, 400);
            assert.equal(string.status, 400);
            assert.equal(nullBody.status, 400);
        }
        console.log(JSON.stringify(summary));
        fs.writeFileSync(`/tmp/fosscord-widget-privacy-${summary.fixed ? "fixed" : "baseline"}.json`, JSON.stringify(summary, null, 2));
    } finally {
        if (user) await e.User.update({ id: user.id }, { profile_widgets: original });
        for (const item of [app, otherApp])
            if (item) {
                await call(admin, "DELETE", `/applications/${item.id}/widget-config`);
                await e.Application.delete({ id: item.id });
                if (item.bot?.id) await e.User.delete({ id: item.bot.id });
            }
        await db.destroy();
    }
})();
