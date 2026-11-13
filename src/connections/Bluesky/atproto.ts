import crypto, { KeyObject } from "node:crypto";
import { normalizeDomain } from "@spacebar/util";

export interface AtprotoNetwork {
    resolveTxt(hostname: string): Promise<string[][]>;
    fetch(url: string, init?: RequestInit): Promise<Response>;
}

export interface DidDocument {
    id: string;
    alsoKnownAs?: string[];
    service?: { id: string; type: string; serviceEndpoint: string }[];
}

export interface AuthorizationServer {
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
    pushed_authorization_request_endpoint: string;
    dpop_signing_alg_values_supported?: string[];
    scopes_supported?: string[];
}

const PLC_DID = /^did:plc:[a-z2-7]{24}$/;
const WEB_DID = /^did:web:([a-z0-9.-]+)$/;

export const isAtprotoDid = (value: string) => PLC_DID.test(value) || (WEB_DID.test(value) && !!normalizeDomain(WEB_DID.exec(value)?.[1] ?? "").domain);

export function normalizeHandle(input: string) {
    const value = input
        .trim()
        .replace(/^@/, "")
        .replace(/^at:\/\//, "");
    if (isAtprotoDid(value)) return { did: value };
    const { domain } = normalizeDomain(value);
    return domain ? { handle: domain } : null;
}

const base64url = (data: Buffer | string) => Buffer.from(data).toString("base64url");

export function pkcePair() {
    const verifier = base64url(crypto.randomBytes(32));
    return { verifier, challenge: base64url(crypto.createHash("sha256").update(verifier).digest()) };
}

export function createDpopKey() {
    return crypto.generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
}

export function dpopProof(key: KeyObject, method: string, url: string, nonce?: string, now = Date.now()) {
    const { kty, crv, x, y } = crypto.createPublicKey(key).export({ format: "jwk" });
    const header = base64url(JSON.stringify({ typ: "dpop+jwt", alg: "ES256", jwk: { kty, crv, x, y } }));
    const target = new URL(url);
    const payload = base64url(
        JSON.stringify({
            jti: base64url(crypto.randomBytes(16)),
            htm: method,
            htu: `${target.origin}${target.pathname}`,
            iat: Math.floor(now / 1000),
            ...(nonce ? { nonce } : {}),
        }),
    );
    const signature = crypto.sign("sha256", Buffer.from(`${header}.${payload}`), { key, dsaEncoding: "ieee-p1363" });
    return `${header}.${payload}.${base64url(signature)}`;
}

async function readJson<T>(network: AtprotoNetwork, url: string): Promise<T | null> {
    const res = await network.fetch(url, { headers: { Accept: "application/json" } }).catch(() => null);
    if (!res?.ok) return null;
    return (await res.json().catch(() => null)) as T | null;
}

export async function resolveHandle(network: AtprotoNetwork, handle: string): Promise<string | null> {
    const records = await network.resolveTxt(`_atproto.${handle}`).catch(() => [] as string[][]);
    const fromDns = records
        .map((chunks) => chunks.join(""))
        .filter((record) => record.startsWith("did="))
        .map((record) => record.slice(4));
    if (fromDns.length === 1 && isAtprotoDid(fromDns[0])) return fromDns[0];

    const res = await network.fetch(`https://${handle}/.well-known/atproto-did`).catch(() => null);
    const did = res?.ok ? (await res.text().catch(() => "")).trim() : "";
    return isAtprotoDid(did) ? did : null;
}

export async function resolveDid(network: AtprotoNetwork, did: string): Promise<DidDocument | null> {
    const host = WEB_DID.exec(did)?.[1];
    const url = host ? `https://${host}/.well-known/did.json` : `https://plc.directory/${did}`;
    const doc = await readJson<DidDocument>(network, url);
    return doc?.id === did ? doc : null;
}

export function pdsEndpoint(doc: DidDocument) {
    const service = doc.service?.find((entry) => (entry.id === "#atproto_pds" || entry.id === `${doc.id}#atproto_pds`) && entry.type === "AtprotoPersonalDataServer");
    if (!service || !URL.canParse(service.serviceEndpoint)) return null;
    const url = new URL(service.serviceEndpoint);
    return url.protocol === "https:" ? url.origin : null;
}

export function claimedHandle(doc: DidDocument) {
    const aka = doc.alsoKnownAs?.find((entry) => entry.startsWith("at://"));
    return aka ? normalizeDomain(aka.slice(5)).domain : undefined;
}

export async function authorizationServerFor(network: AtprotoNetwork, pds: string): Promise<AuthorizationServer | null> {
    const resource = await readJson<{ authorization_servers?: string[] }>(network, `${pds}/.well-known/oauth-protected-resource`);
    const issuer = resource?.authorization_servers?.[0];
    if (!issuer || !URL.canParse(issuer) || new URL(issuer).protocol !== "https:") return null;
    const metadata = await readJson<AuthorizationServer>(network, `${new URL(issuer).origin}/.well-known/oauth-authorization-server`);
    if (!metadata || metadata.issuer !== issuer) return null;
    const endpoints = [metadata.authorization_endpoint, metadata.token_endpoint, metadata.pushed_authorization_request_endpoint];
    if (!endpoints.every((endpoint) => typeof endpoint === "string" && URL.canParse(endpoint) && new URL(endpoint).protocol === "https:")) return null;
    if (metadata.dpop_signing_alg_values_supported && !metadata.dpop_signing_alg_values_supported.includes("ES256")) return null;
    return metadata;
}

export async function dpopPost<T>(
    network: AtprotoNetwork,
    url: string,
    body: URLSearchParams,
    key: KeyObject,
    nonce?: string,
): Promise<{ status: number; body: T; nonce?: string }> {
    let currentNonce = nonce;
    for (let attempt = 0; attempt < 2; attempt++) {
        const res = await network.fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", DPoP: dpopProof(key, "POST", url, currentNonce) },
            body: body.toString(),
        });
        const next = res.headers.get("dpop-nonce") ?? currentNonce;
        const json = (await res.json().catch(() => ({}))) as T & { error?: string };
        if (res.status === 400 && json.error === "use_dpop_nonce" && next && next !== currentNonce) {
            currentNonce = next;
            continue;
        }
        return { status: res.status, body: json, nonce: next };
    }
    throw new Error("DPoP nonce was not accepted");
}
