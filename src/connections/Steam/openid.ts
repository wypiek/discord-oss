export const STEAM_OPENID_ENDPOINT = "https://steamcommunity.com/openid/login";
export const OPENID_NS = "http://specs.openid.net/auth/2.0";
const IDENTIFIER_SELECT = `${OPENID_NS}/identifier_select`;
const CLAIMED_ID = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;
const REQUIRED_SIGNED_FIELDS = ["op_endpoint", "claimed_id", "identity", "return_to", "response_nonce"];
const NONCE_LIFETIME = 10 * 60 * 1000;

export function steamLoginUrl(returnTo: string, realm: string) {
    const url = new URL(STEAM_OPENID_ENDPOINT);
    url.search = new URLSearchParams({
        "openid.ns": OPENID_NS,
        "openid.mode": "checkid_setup",
        "openid.return_to": returnTo,
        "openid.realm": realm,
        "openid.identity": IDENTIFIER_SELECT,
        "openid.claimed_id": IDENTIFIER_SELECT,
    }).toString();
    return url.toString();
}

export function steamIdFromAssertion(params: Record<string, string> | undefined, redirectUri: string, state: string, now = Date.now()): string | null {
    if (!params) return null;
    if (params["openid.ns"] !== OPENID_NS || params["openid.mode"] !== "id_res" || params["openid.op_endpoint"] !== STEAM_OPENID_ENDPOINT) return null;

    const claimed = params["openid.claimed_id"];
    const steamId = CLAIMED_ID.exec(claimed ?? "")?.[1];
    if (!steamId || params["openid.identity"] !== claimed) return null;

    const signed = (params["openid.signed"] ?? "").split(",");
    if (!REQUIRED_SIGNED_FIELDS.every((field) => signed.includes(field)) || !params["openid.sig"] || !params["openid.assoc_handle"]) return null;

    let returnTo: URL;
    try {
        returnTo = new URL(params["openid.return_to"] ?? "");
    } catch {
        return null;
    }
    const expected = new URL(redirectUri);
    if (returnTo.origin !== expected.origin || returnTo.pathname !== expected.pathname || returnTo.searchParams.get("state") !== state) return null;

    const issuedAt = Date.parse((params["openid.response_nonce"] ?? "").slice(0, 20));
    if (!Number.isFinite(issuedAt) || Math.abs(now - issuedAt) > NONCE_LIFETIME) return null;

    return steamId;
}

export function checkAuthenticationBody(params: Record<string, string>) {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (key.startsWith("openid.")) body.set(key, value);
    body.set("openid.mode", "check_authentication");
    return body;
}

export const isValidCheckAuthenticationResponse = (text: string) => text.split("\n").some((line) => line.trim() === "is_valid:true");

export function personaNameFromProfileXml(xml: string) {
    const match = /<steamID>\s*(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))\s*<\/steamID>/.exec(xml);
    const name = (match?.[1] ?? match?.[2] ?? "").trim();
    return name ? name.slice(0, 100) : null;
}
