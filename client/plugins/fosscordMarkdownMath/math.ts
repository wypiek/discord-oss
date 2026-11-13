import katex from "katex";

export const MAX_FORMULA_LENGTH = 2000;
const CACHE_SIZE = 256;

const KATEX_OPTIONS = {
    throwOnError: true,
    trust: false,
    strict: "ignore",
    maxExpand: 1000,
    maxSize: 20,
    output: "htmlAndMathml",
} as const;

const ALLOWED_TAGS = new Set([
    "span",
    "math",
    "semantics",
    "annotation",
    "mrow",
    "mi",
    "mn",
    "mo",
    "ms",
    "mtext",
    "mspace",
    "mfrac",
    "msqrt",
    "mroot",
    "msub",
    "msup",
    "msubsup",
    "munder",
    "mover",
    "munderover",
    "mtable",
    "mtr",
    "mtd",
    "mstyle",
    "mpadded",
    "mphantom",
    "menclose",
    "mglyph",
    "svg",
    "path",
    "line",
    "rect",
]);

const ALLOWED_ATTRIBUTES = new Set([
    "class",
    "style",
    "aria-hidden",
    "xmlns",
    "encoding",
    "display",
    "mathvariant",
    "mathcolor",
    "mathbackground",
    "stretchy",
    "fence",
    "separator",
    "lspace",
    "rspace",
    "minsize",
    "maxsize",
    "symmetric",
    "accent",
    "accentunder",
    "linethickness",
    "scriptlevel",
    "displaystyle",
    "columnalign",
    "columnspacing",
    "columnlines",
    "rowalign",
    "rowspacing",
    "rowlines",
    "frame",
    "framespacing",
    "notation",
    "width",
    "height",
    "depth",
    "voffset",
    "viewbox",
    "preserveaspectratio",
    "d",
    "x",
    "y",
    "x1",
    "y1",
    "x2",
    "y2",
    "rx",
    "ry",
    "fill",
    "stroke",
    "stroke-width",
    "stroke-dasharray",
]);

const UNSAFE_VALUE = /url\s*\(|expression\s*\(|javascript:|vbscript:|data:|@import|[<>\\]/i;
const TAG = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=/>]+(?:="[^"]*")?)*)\s*(\/?)>/y;
const ATTRIBUTE = /\s+([^\s=/>]+)(?:="([^"]*)")?/y;
const ENTITY = /&(?:#(\d+)|#x([0-9a-f]+)|(\w+));/gi;
const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

const decodeEntities = (value: string) =>
    value.replace(ENTITY, (whole, decimal, hex, name) => {
        if (decimal) return String.fromCodePoint(Math.min(Number(decimal), 0x10ffff));
        if (hex) return String.fromCodePoint(Math.min(Number.parseInt(hex, 16), 0x10ffff));
        return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
    });

const safeAttributes = (source: string) => {
    ATTRIBUTE.lastIndex = 0;
    while (ATTRIBUTE.lastIndex < source.length) {
        const match = ATTRIBUTE.exec(source);
        if (!match) return source.slice(ATTRIBUTE.lastIndex).trim() === "";
        if (!ALLOWED_ATTRIBUTES.has(match[1].toLowerCase())) return false;
        if (match[2] !== undefined && UNSAFE_VALUE.test(decodeEntities(match[2]))) return false;
    }
    return true;
};

export function isSafeMathMarkup(html: string) {
    let position = 0;
    while (position < html.length) {
        const next = html.indexOf("<", position);
        if (next < 0) return !html.slice(position).includes(">");
        if (html.slice(position, next).includes(">")) return false;
        TAG.lastIndex = next;
        const match = TAG.exec(html);
        if (!match) return false;
        if (!ALLOWED_TAGS.has(match[2].toLowerCase())) return false;
        if (match[1] && match[3].trim()) return false;
        if (!safeAttributes(match[3])) return false;
        position = TAG.lastIndex;
    }
    return true;
}

const cache = new Map<string, string | null>();

const remember = (key: string, value: string | null) => {
    if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value as string);
    cache.set(key, value);
    return value;
};

export function renderMath(tex: string, displayMode: boolean): string | null {
    const source = tex.trim();
    if (!source || source.length > MAX_FORMULA_LENGTH) return null;
    const key = `${displayMode ? "D" : "I"}${source}`;
    if (cache.has(key)) return cache.get(key) ?? null;
    let html: string;
    try {
        html = katex.renderToString(source, { ...KATEX_OPTIONS, displayMode });
    } catch {
        return remember(key, null);
    }
    return remember(key, isSafeMathMarkup(html) ? html : null);
}

interface InlineState {
    src: string;
    pos: number;
    push(type: string, tag: string, nesting: number): { content: string; markup: string };
}

interface BlockState {
    src: string;
    bMarks: number[];
    eMarks: number[];
    tShift: number[];
    sCount: number[];
    blkIndent: number;
    line: number;
    push(type: string, tag: string, nesting: number): { content: string; markup: string; block: boolean; map: [number, number] | null };
}

interface MarkdownIt {
    inline: { ruler: { before(name: string, rule: string, fn: (state: InlineState, silent: boolean) => boolean): void } };
    block: {
        ruler: {
            before(name: string, rule: string, fn: (state: BlockState, startLine: number, endLine: number, silent: boolean) => boolean, options?: { alt: string[] }): void;
        };
    };
}

const BACKSLASH = 0x5c;

function bracketInline(state: InlineState, silent: boolean) {
    const { src, pos } = state;
    if (src.charCodeAt(pos) !== BACKSLASH) return false;
    const open = src[pos + 1];
    if (open !== "(" && open !== "[") return false;
    const end = src.indexOf(open === "(" ? "\\)" : "\\]", pos + 2);
    if (end < 0) return false;
    const content = src.slice(pos + 2, end);
    if (!content.trim()) return false;
    if (!silent) {
        const token = state.push(open === "(" ? "math_inline" : "math_inline_double", "math", 0);
        token.content = content.trim();
        token.markup = `\\${open}`;
    }
    state.pos = end + 2;
    return true;
}

function bracketBlock(state: BlockState, startLine: number, endLine: number, silent: boolean) {
    if (state.sCount[startLine] - state.blkIndent >= 4) return false;
    const start = state.bMarks[startLine] + state.tShift[startLine];
    if (!state.src.startsWith("\\[", start)) return false;
    const lines = [state.src.slice(start + 2, state.eMarks[startLine]).trimEnd()];
    let line = startLine;
    while (!lines[lines.length - 1].endsWith("\\]")) {
        line++;
        if (line >= endLine) return false;
        const lineStart = state.bMarks[line] + state.tShift[line];
        if (lineStart >= state.eMarks[line]) return false;
        lines.push(state.src.slice(lineStart, state.eMarks[line]).trimEnd());
    }
    const content = lines.join("\n").slice(0, -2).trim();
    if (!content) return false;
    if (silent) return true;
    state.line = line + 1;
    const token = state.push("math_block", "math", 0);
    token.block = true;
    token.content = content;
    token.markup = "\\[";
    token.map = [startLine, state.line];
    return true;
}

export function bracketMath(md: MarkdownIt) {
    md.inline.ruler.before("escape", "fosscord_math_bracket_inline", bracketInline);
    md.block.ruler.before("fence", "fosscord_math_bracket_block", bracketBlock, { alt: ["paragraph", "reference", "blockquote", "list"] });
    return md;
}

export const isDisplayMath = (type: string) => type === "math_block" || type === "math_inline_double";
export const isMathToken = (type: string) => type === "math_inline" || isDisplayMath(type);
