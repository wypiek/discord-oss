import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import { AtprotoNetwork, claimedHandle, createDpopKey, dpopPost, dpopProof, normalizeHandle, pdsEndpoint, resolveHandle } from "./atproto";

const did = "did:plc:ewvi7nxzyoun6zhxrhs64oiz";
const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json", ...init.headers } });

test("handles and DIDs are normalized and other input is refused", () => {
    assert.deepEqual(normalizeHandle("@Alice.BSKY.social"), { handle: "alice.bsky.social" });
    assert.deepEqual(normalizeHandle(did), { did });
    assert.deepEqual(normalizeHandle("did:web:example.dev"), { did: "did:web:example.dev" });
    assert.equal(normalizeHandle("alice"), null);
    assert.equal(normalizeHandle("did:plc:short"), null);
    assert.equal(normalizeHandle("printer.local"), null);
});

test("a handle resolves through its _atproto TXT record before the well-known file", async () => {
    const fetched: string[] = [];
    const network: AtprotoNetwork = {
        resolveTxt: async (hostname) => (hostname === "_atproto.alice.dev" ? [[`did=${did}`]] : []),
        fetch: async (url) => {
            fetched.push(url);
            return new Response(url === "https://bob.dev/.well-known/atproto-did" ? `${did}\n` : "missing", { status: url.includes("bob.dev") ? 200 : 404 });
        },
    };
    assert.equal(await resolveHandle(network, "alice.dev"), did);
    assert.deepEqual(fetched, []);
    assert.equal(await resolveHandle(network, "bob.dev"), did);
    assert.equal(await resolveHandle(network, "carol.dev"), null);
});

test("the PDS and handle come from the DID document", () => {
    const doc = {
        id: did,
        alsoKnownAs: ["at://Alice.dev"],
        service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: "https://pds.example.dev/" }],
    };
    assert.equal(pdsEndpoint(doc), "https://pds.example.dev");
    assert.equal(claimedHandle(doc), "alice.dev");
    assert.equal(pdsEndpoint({ ...doc, service: [{ ...doc.service[0], serviceEndpoint: "http://pds.example.dev" }] }), null);
});

test("DPoP proofs are ES256 JWTs bound to the method, URL and nonce", () => {
    const key = createDpopKey();
    const [header, payload, signature] = dpopProof(key, "POST", "https://bsky.social/oauth/par?x=1", "n1").split(".");
    const parsedHeader = JSON.parse(Buffer.from(header, "base64url").toString());
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    assert.equal(parsedHeader.typ, "dpop+jwt");
    assert.equal(parsedHeader.alg, "ES256");
    assert.equal(parsedHeader.jwk.d, undefined);
    assert.deepEqual([claims.htm, claims.htu, claims.nonce], ["POST", "https://bsky.social/oauth/par", "n1"]);
    const publicKey = crypto.createPublicKey({ key: parsedHeader.jwk, format: "jwk" });
    assert.equal(crypto.verify("sha256", Buffer.from(`${header}.${payload}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url")), true);
});

test("a use_dpop_nonce answer is retried once with the server's nonce", async () => {
    const nonces: (string | undefined)[] = [];
    const network: AtprotoNetwork = {
        resolveTxt: async () => [],
        fetch: async (_url, init) => {
            const proof = String((init?.headers as Record<string, string> | undefined)?.DPoP);
            const nonce = JSON.parse(Buffer.from(proof.split(".")[1], "base64url").toString()).nonce;
            nonces.push(nonce);
            return nonce === "fresh"
                ? json({ request_uri: "urn:req" }, { status: 201, headers: { "DPoP-Nonce": "fresh" } })
                : json({ error: "use_dpop_nonce" }, { status: 400, headers: { "DPoP-Nonce": "fresh" } });
        },
    };
    const result = await dpopPost<{ request_uri: string }>(network, "https://bsky.social/oauth/par", new URLSearchParams(), createDpopKey());
    assert.deepEqual(nonces, [undefined, "fresh"]);
    assert.equal(result.body.request_uri, "urn:req");
    assert.equal(result.nonce, "fresh");
});
