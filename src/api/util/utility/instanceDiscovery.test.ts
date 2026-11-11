import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigValue } from "@spacebar/util";
import { buildInstanceDiscovery, InstanceDiscoveryInput } from "./instanceDiscovery";

const input = (config: ConfigValue, overrides: Partial<InstanceDiscoveryInput> = {}): InstanceDiscoveryInput => ({
    config,
    origin: "https://chat.example.org",
    name: "Example Chat",
    description: "A test instance",
    iconPath: "/static/logo.png?v=abc",
    logoPath: null,
    themeColor: "#3BA3E8",
    version: "1.2.3",
    supportUrl: null,
    captcha: { endpoint: "/api/v9/auth/cap/", sitekey: "fosscord" },
    ...overrides,
});

test("the endpoints come from the public config and fall back to the request origin", () => {
    const config = new ConfigValue();
    config.api.endpointPublic = "https://api.example.org/api/v9";
    config.gateway.endpointPublic = "wss://gateway.example.org/";
    config.cdn.endpointPublic = null;
    const discovery = buildInstanceDiscovery(input(config));
    assert.equal(discovery.api.url, "https://api.example.org/api");
    assert.equal(discovery.gateway.url, "wss://gateway.example.org");
    assert.equal(discovery.cdn.url, "https://chat.example.org");
    assert.equal(discovery.instance.icon, "https://chat.example.org/static/logo.png?v=abc");
    assert.equal(discovery.links.support, "https://chat.example.org/support");

    const bare = new ConfigValue();
    bare.api.endpointPublic = null;
    bare.gateway.endpointPublic = null;
    const fallback = buildInstanceDiscovery(input(bare, { origin: "http://localhost:3001" }));
    assert.equal(fallback.api.url, "http://localhost:3001/api");
    assert.equal(fallback.gateway.url, "ws://localhost:3001");
});

test("registration says whether it is open and what a signup needs", () => {
    const config = new ConfigValue();
    config.register.requireInvite = true;
    config.register.joinReason.required = true;
    let discovery = buildInstanceDiscovery(input(config));
    assert.equal(discovery.registration.open, true);
    assert.equal(discovery.registration.invite_required, true);
    assert.deepEqual(discovery.registration.join_reason, { required: true, min_length: 20, max_length: 1000 });
    assert.deepEqual(discovery.registration.captcha, { service: "cap", sitekey: "fosscord", endpoint: "https://chat.example.org/api/v9/auth/cap/" });

    config.register.disabled = true;
    config.register.requireCaptcha = false;
    discovery = buildInstanceDiscovery(input(config));
    assert.equal(discovery.registration.open, false);
    assert.equal(discovery.registration.captcha, null);
});

test("the response names the software and both protocol versions", () => {
    const discovery = buildInstanceDiscovery(input(new ConfigValue()));
    assert.deepEqual(discovery.software, { name: "discord-oss", version: "1.2.3" });
    assert.equal(discovery.protocol, 1);
    assert.equal(discovery.e2ee.protocol, 1);
    assert.ok(discovery.voice.regions.some((region) => region.default));
});
