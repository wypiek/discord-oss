import crypto from "node:crypto";
import net from "node:net";
import { domainToASCII } from "node:url";

export type DomainRejection = "syntax" | "ip" | "length" | "reserved";
export type DomainNormalization = { domain: string; rejection?: undefined } | { domain?: undefined; rejection: DomainRejection };

export type DomainVerificationResult = "verified" | "missing" | "mismatch" | "unavailable";

export interface DomainVerifier {
    resolveTxt(hostname: string): Promise<string[][]>;
    fetchText(url: string): Promise<string | null>;
}

export interface DomainVerificationOptions {
    httpSchemes: ("https" | "http")[];
}

const RESERVED_SUFFIXES = new Set([
    "localhost",
    "local",
    "localdomain",
    "internal",
    "intranet",
    "lan",
    "home",
    "corp",
    "private",
    "test",
    "example",
    "invalid",
    "onion",
    "alt",
    "arpa",
    "example.com",
    "example.net",
    "example.org",
]);
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const TOP_LEVEL_LABEL = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;
const MISSING_RECORD_CODES = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN", "ENONAME"]);

export const MAX_DOMAIN_LENGTH = 253;

export function normalizeDomain(input: string): DomainNormalization {
    const trimmed = input.trim().toLowerCase().replace(/\.$/, "");
    if (!trimmed) return { rejection: "syntax" };
    if (trimmed.length > MAX_DOMAIN_LENGTH * 4) return { rejection: "length" };
    if (net.isIP(trimmed) || net.isIP(trimmed.replace(/^\[|\]$/g, ""))) return { rejection: "ip" };
    if (/[\s/\\:@?#%*_]/.test(trimmed)) return { rejection: "syntax" };
    if (/^(?:\d+|0x[0-9a-f]+)$/.test(trimmed.split(".").at(-1) ?? "")) return { rejection: "ip" };
    const ascii = domainToASCII(trimmed);
    if (!ascii) return { rejection: "syntax" };
    if (ascii.length > MAX_DOMAIN_LENGTH) return { rejection: "length" };
    const labels = ascii.split(".");
    if (labels.length < 2) return { rejection: RESERVED_SUFFIXES.has(ascii) ? "reserved" : "syntax" };
    if (labels.some((label) => label.length > 63)) return { rejection: "length" };
    if (!labels.every((label) => LABEL.test(label))) return { rejection: "syntax" };
    const topLevel = labels[labels.length - 1];
    if (!TOP_LEVEL_LABEL.test(topLevel)) return { rejection: "syntax" };
    if (RESERVED_SUFFIXES.has(topLevel) || RESERVED_SUFFIXES.has(labels.slice(-2).join("."))) return { rejection: "reserved" };
    return { domain: ascii };
}

export function domainProof(secret: string | Buffer, userId: string, domain: string) {
    return `dh=${crypto.createHmac("sha256", secret).update(`domain-connection:${userId}:${domain}`).digest("hex").slice(0, 40)}`;
}

export function domainRecordName(domain: string) {
    return `_discord.${domain}`;
}

export function domainWellKnownUrl(domain: string, scheme: "https" | "http" = "https") {
    return `${scheme}://${domain}/.well-known/discord`;
}

const matchesProof = (value: string, proof: string) => value.trim().toLowerCase() === proof.toLowerCase();
const looksLikeProof = (value: string) => /^dh=/i.test(value.trim());

export async function verifyDomain(domain: string, proof: string, verifier: DomainVerifier, options: DomainVerificationOptions): Promise<DomainVerificationResult> {
    let mismatch = false;
    let unavailable = false;

    try {
        const records = (await verifier.resolveTxt(domainRecordName(domain))).map((chunks) => chunks.join(""));
        if (records.some((record) => matchesProof(record, proof))) return "verified";
        if (records.some(looksLikeProof)) mismatch = true;
    } catch (error) {
        if (!MISSING_RECORD_CODES.has((error as NodeJS.ErrnoException)?.code ?? "")) unavailable = true;
    }

    for (const scheme of options.httpSchemes) {
        const body = await verifier.fetchText(domainWellKnownUrl(domain, scheme)).catch(() => null);
        if (body == null) continue;
        const lines = body.slice(0, 1024).split(/\r?\n/);
        if (lines.some((line) => matchesProof(line, proof))) return "verified";
        if (lines.some(looksLikeProof)) mismatch = true;
    }

    if (mismatch) return "mismatch";
    return unavailable ? "unavailable" : "missing";
}
