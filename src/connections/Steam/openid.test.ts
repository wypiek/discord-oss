import assert from "node:assert/strict";
import { test } from "node:test";
import {
    OPENID_NS,
    STEAM_OPENID_ENDPOINT,
    checkAuthenticationBody,
    isValidCheckAuthenticationResponse,
    personaNameFromProfileXml,
    steamIdFromAssertion,
    steamLoginUrl,
} from "./openid";

const redirect = "https://chat.example.dev/connections/steam/callback";
const now = Date.parse("2026-11-13T12:00:00Z");
const assertion = (overrides: Record<string, string> = {}) => ({
    "openid.ns": OPENID_NS,
    "openid.mode": "id_res",
    "openid.op_endpoint": STEAM_OPENID_ENDPOINT,
    "openid.claimed_id": "https://steamcommunity.com/openid/id/76561197960287930",
    "openid.identity": "https://steamcommunity.com/openid/id/76561197960287930",
    "openid.return_to": `${redirect}?state=abc`,
    "openid.response_nonce": "2026-11-13T11:59:30Zx1y2z3",
    "openid.assoc_handle": "1234567890",
    "openid.signed": "signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle",
    "openid.sig": "c2lnbmF0dXJl",
    ...overrides,
});

test("the login URL asks Steam to pick the identity and return to the callback", () => {
    const url = new URL(steamLoginUrl(`${redirect}?state=abc`, "https://chat.example.dev"));
    assert.equal(url.origin + url.pathname, STEAM_OPENID_ENDPOINT);
    assert.equal(url.searchParams.get("openid.mode"), "checkid_setup");
    assert.equal(url.searchParams.get("openid.return_to"), `${redirect}?state=abc`);
    assert.equal(url.searchParams.get("openid.claimed_id"), `${OPENID_NS}/identifier_select`);
});

test("a complete assertion yields the steamid64", () => {
    assert.equal(steamIdFromAssertion(assertion(), redirect, "abc", now), "76561197960287930");
});

test("assertions with the wrong state, endpoint, identity, signature list or age are refused", () => {
    assert.equal(steamIdFromAssertion(assertion(), redirect, "other", now), null);
    assert.equal(steamIdFromAssertion(assertion({ "openid.return_to": `https://evil.example.dev/connections/steam/callback?state=abc` }), redirect, "abc", now), null);
    assert.equal(steamIdFromAssertion(assertion({ "openid.op_endpoint": "https://evil.example.dev/openid/login" }), redirect, "abc", now), null);
    assert.equal(steamIdFromAssertion(assertion({ "openid.claimed_id": "https://evil.example.dev/openid/id/76561197960287930" }), redirect, "abc", now), null);
    assert.equal(steamIdFromAssertion(assertion({ "openid.identity": "https://steamcommunity.com/openid/id/76561197960287931" }), redirect, "abc", now), null);
    assert.equal(steamIdFromAssertion(assertion({ "openid.signed": "signed,op_endpoint,claimed_id,identity" }), redirect, "abc", now), null);
    assert.equal(steamIdFromAssertion(assertion({ "openid.mode": "cancel" }), redirect, "abc", now), null);
    assert.equal(steamIdFromAssertion(assertion({ "openid.response_nonce": "2026-11-13T11:00:00Zold" }), redirect, "abc", now), null);
    assert.equal(steamIdFromAssertion(undefined, redirect, "abc", now), null);
});

test("check_authentication resends only the openid fields with the mode switched", () => {
    const body = checkAuthenticationBody({ ...assertion(), unrelated: "x" });
    assert.equal(body.get("openid.mode"), "check_authentication");
    assert.equal(body.get("openid.sig"), "c2lnbmF0dXJl");
    assert.equal(body.get("unrelated"), null);
    assert.equal(isValidCheckAuthenticationResponse("ns:http://specs.openid.net/auth/2.0\nis_valid:true\n"), true);
    assert.equal(isValidCheckAuthenticationResponse("ns:http://specs.openid.net/auth/2.0\nis_valid:false\n"), false);
});

test("the persona name is read from the public profile XML", () => {
    assert.equal(personaNameFromProfileXml("<profile><steamID64>1</steamID64><steamID><![CDATA[Gabe <3]]></steamID></profile>"), "Gabe <3");
    assert.equal(personaNameFromProfileXml("<response><error>The specified profile could not be found.</error></response>"), null);
});
