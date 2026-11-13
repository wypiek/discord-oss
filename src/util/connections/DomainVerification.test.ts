import assert from "node:assert/strict";
import { test } from "node:test";
import { DomainVerifier, domainProof, normalizeDomain, verifyDomain } from "./DomainVerification";

const dnsError = (code: string) => Object.assign(new Error(code), { code });

const verifier = (txt: Record<string, string[][] | Error>, files: Record<string, string> = {}) => {
    const lookups: string[] = [];
    const fetches: string[] = [];
    const stub: DomainVerifier = {
        async resolveTxt(hostname) {
            lookups.push(hostname);
            const records = txt[hostname] ?? dnsError("ENOTFOUND");
            if (records instanceof Error) throw records;
            return records;
        },
        async fetchText(url) {
            fetches.push(url);
            return files[url] ?? null;
        },
    };
    return { stub, lookups, fetches };
};

const proof = domainProof("secret", "1234", "my-site.dev");
const https = { httpSchemes: ["https" as const] };

test("normalizes public domains and rejects addresses, reserved names and bad syntax", () => {
    assert.deepEqual(normalizeDomain("  My-Site.DEV. "), { domain: "my-site.dev" });
    assert.equal(normalizeDomain("example.org").rejection, "reserved");
    assert.deepEqual(normalizeDomain("bücher.ch"), { domain: "xn--bcher-kva.ch" });
    assert.deepEqual(normalizeDomain("sub.domain.co.uk"), { domain: "sub.domain.co.uk" });
    assert.equal(normalizeDomain("127.0.0.1").rejection, "ip");
    assert.equal(normalizeDomain("[::1]").rejection, "ip");
    assert.equal(normalizeDomain("2130706433.123").rejection, "ip");
    assert.equal(normalizeDomain("localhost").rejection, "reserved");
    assert.equal(normalizeDomain("printer.localhost").rejection, "reserved");
    assert.equal(normalizeDomain("nas.local").rejection, "reserved");
    assert.equal(normalizeDomain("db.internal").rejection, "reserved");
    assert.equal(normalizeDomain("example.com").rejection, "reserved");
    assert.equal(normalizeDomain("https://my-site.dev/path").rejection, "syntax");
    assert.equal(normalizeDomain("user@my-site.dev").rejection, "syntax");
    assert.equal(normalizeDomain("my-site.dev:8080").rejection, "syntax");
    assert.equal(normalizeDomain("-bad.my-site.dev").rejection, "syntax");
    assert.equal(normalizeDomain("bad_label.my-site.dev").rejection, "syntax");
    assert.equal(normalizeDomain("a..b.org").rejection, "syntax");
    assert.equal(normalizeDomain("").rejection, "syntax");
    assert.equal(normalizeDomain("intranet-host").rejection, "syntax");
    assert.equal(normalizeDomain(`${"a".repeat(64)}.org`).rejection, "length");
    assert.equal(normalizeDomain(`${Array.from({ length: 5 }, () => "a".repeat(60)).join(".")}.org`).rejection, "length");
});

test("proofs follow the dh= format and differ per user and domain", () => {
    assert.match(proof, /^dh=[0-9a-f]{40}$/);
    assert.equal(proof, domainProof("secret", "1234", "my-site.dev"));
    assert.notEqual(proof, domainProof("secret", "5678", "my-site.dev"));
    assert.notEqual(proof, domainProof("secret", "1234", "other-site.dev"));
});

test("a matching TXT record at _discord verifies without fetching the website", async () => {
    const { stub, lookups, fetches } = verifier({ "_discord.my-site.dev": [["unrelated"], [proof.slice(0, 10), proof.slice(10)]] });
    assert.equal(await verifyDomain("my-site.dev", proof, stub, https), "verified");
    assert.deepEqual(lookups, ["_discord.my-site.dev"]);
    assert.deepEqual(fetches, []);
});

test("the well-known file verifies when there is no TXT record", async () => {
    const { stub, fetches } = verifier({}, { "https://my-site.dev/.well-known/discord": `${proof}\n` });
    assert.equal(await verifyDomain("my-site.dev", proof, stub, https), "verified");
    assert.deepEqual(fetches, ["https://my-site.dev/.well-known/discord"]);
});

test("plain http is only tried when the instance itself is served over http", async () => {
    const files = { "http://my-site.dev/.well-known/discord": proof };
    assert.equal(await verifyDomain("my-site.dev", proof, verifier({}, files).stub, https), "missing");
    assert.equal(await verifyDomain("my-site.dev", proof, verifier({}, files).stub, { httpSchemes: ["https", "http"] }), "verified");
});

test("another user's code is reported as a mismatch", async () => {
    const otherProof = domainProof("secret", "5678", "my-site.dev");
    assert.equal(await verifyDomain("my-site.dev", proof, verifier({ "_discord.my-site.dev": [[otherProof]] }).stub, https), "mismatch");
    assert.equal(await verifyDomain("my-site.dev", proof, verifier({}, { "https://my-site.dev/.well-known/discord": otherProof }).stub, https), "mismatch");
});

test("missing records and failing DNS servers are told apart", async () => {
    assert.equal(await verifyDomain("my-site.dev", proof, verifier({ "_discord.my-site.dev": dnsError("ENODATA") }).stub, https), "missing");
    assert.equal(await verifyDomain("my-site.dev", proof, verifier({ "_discord.my-site.dev": dnsError("ETIMEOUT") }).stub, https), "unavailable");
    assert.equal(await verifyDomain("my-site.dev", proof, verifier({ "_discord.my-site.dev": dnsError("ESERVFAIL") }).stub, https), "unavailable");
    const failingFetch: DomainVerifier = { resolveTxt: async () => [], fetchText: async () => Promise.reject(new Error("refused")) };
    assert.equal(await verifyDomain("my-site.dev", proof, failingFetch, https), "missing");
});

test("a record at the bare domain does not count", async () => {
    const { stub, lookups } = verifier({ "my-site.dev": [[proof]] });
    assert.equal(await verifyDomain("my-site.dev", proof, stub, https), "missing");
    assert.deepEqual(lookups, ["_discord.my-site.dev"]);
});
