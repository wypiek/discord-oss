import { Resolver } from "node:dns/promises";
import {
    Config,
    DomainRejection,
    DomainVerificationResult,
    DomainVerifier,
    JwtKeypairManager,
    domainProof,
    domainRecordName,
    domainWellKnownUrl,
    fetchPublicUrl,
    normalizeDomain,
    publicWebOrigin,
    verifyDomain,
} from "@spacebar/util";

const resolver = new Resolver({ timeout: 4000, tries: 2 });

const networkVerifier: DomainVerifier = {
    resolveTxt: (hostname) => resolver.resolveTxt(hostname),
    async fetchText(url) {
        const res = await fetchPublicUrl(url, { redirect: "error" }, 0, {
            maxBytes: 4096,
            timeoutMs: 5000,
            allowExternal: Config.get().externalRequests.thirdParty,
        });
        return res.ok ? await res.text() : null;
    },
};

const rejectionMessages: Record<DomainRejection, string> = {
    syntax: "Enter a domain name like example.com, without http:// or a path.",
    ip: "Enter a domain name like example.com. IP addresses can't be connected.",
    length: "This domain is too long. A domain can have up to 253 characters and 63 between each dot.",
    reserved: "This domain only works on private networks, so it can't be verified. Use a public domain.",
};

export const DomainConnection = {
    normalize: normalizeDomain,

    rejectionMessage: (rejection: DomainRejection) => rejectionMessages[rejection],

    proof(userId: string, domain: string) {
        return domainProof(JwtKeypairManager.keypair.privateKey.export({ format: "pem", type: "sec1" }), userId, domain);
    },

    httpSchemes(): ("https" | "http")[] {
        return publicWebOrigin().startsWith("http:") ? ["https", "http"] : ["https"];
    },

    verify(domain: string, proof: string, verifier: DomainVerifier = networkVerifier) {
        return verifyDomain(domain, proof, verifier, { httpSchemes: this.httpSchemes() });
    },

    failureMessage(result: Exclude<DomainVerificationResult, "verified">, domain: string, proof: string) {
        const fileUrl = domainWellKnownUrl(domain, this.httpSchemes().at(-1));
        if (result === "mismatch") return `The record we found for ${domain} doesn't match. Set its value to ${proof} exactly, then check again.`;
        if (result === "unavailable") return `We couldn't look up ${domain} right now. Make sure its DNS servers are answering, then try again in a few minutes.`;
        return `We couldn't find a TXT record at ${domainRecordName(domain)} or a file at ${fileUrl}. New records can take a few minutes to show up.`;
    },
};
