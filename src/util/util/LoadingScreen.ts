import { parser } from "sax";
import { HTTPError } from "lambert-server/HTTPError";

const tags = new Set(
    "svg g defs path rect circle ellipse line polyline polygon text tspan title desc use symbol clipPath mask linearGradient radialGradient stop filter feGaussianBlur feOffset feBlend feColorMatrix feComposite feFlood feMerge feMergeNode animate animateTransform animateMotion mpath set style".split(
        " ",
    ),
);

export function validateLoadingSvg(value: unknown): string | null {
    if (value === null || value === "") return null;
    const fail = () => {
        throw new HTTPError("Use a valid SVG under 64 KB with no scripts, external resources or embedded HTML", 400);
    };
    if (typeof value !== "string" || Buffer.byteLength(value) > 65536 || !/^\s*<svg(?:\s|>)/.test(value)) return fail();
    if (/<!|<\?|@import|expression\s*\(|javascript:|data:|https?:|\/\//i.test(value.replace(/http:\/\/www\.w3\.org\/2000\/svg|http:\/\/www\.w3\.org\/1999\/xlink/g, "")))
        return fail();
    const xml = parser(true, { xmlns: false });
    let depth = 0;
    let roots = 0;
    let nodes = 0;
    xml.onopentag = (tag) => {
        if (!tags.has(tag.name) || (depth === 0 && (tag.name !== "svg" || ++roots !== 1))) fail();
        if (++nodes > 1000 || ++depth > 64) fail();
        for (const [name, raw] of Object.entries(tag.attributes)) {
            const text = String(raw);
            if (/^on/i.test(name) || name === "xml:base" || (/(?:url|expression)\s*\(/i.test(text) && !/^url\(#[\w-]+\)$/.test(text))) fail();
            if (/href$/i.test(name) && !/^#[\w-]+$/.test(text)) fail();
            if (name === "attributeName" && /href|on|style|src/i.test(text)) fail();
        }
    };
    xml.onclosetag = () => {
        depth--;
    };
    xml.ontext = (text) => {
        if ((!depth && text.trim()) || /url\s*\(\s*[^#]|@import|expression\s*\(/i.test(text)) fail();
    };
    xml.onerror = fail;
    try {
        xml.write(value).close();
    } catch {
        return fail();
    }
    if (depth !== 0 || roots !== 1) return fail();
    return value.trim();
}

export function validateLoadingTips(value: unknown): string[] | null {
    if (value === null) return null;
    if (!Array.isArray(value) || value.length > 100 || value.some((tip) => typeof tip !== "string" || tip.length > 500))
        throw new HTTPError("Use up to 100 loading tips, each under 500 characters", 400);
    const tips = value.map((tip: string) => tip.trim()).filter(Boolean);
    return tips.length ? tips : null;
}
