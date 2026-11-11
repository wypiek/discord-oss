export interface MarkdownOptions {
    imageOrigins?: string[];
    headingOffset?: number;
}

const MAX_BLOCK_DEPTH = 6;
const MAX_INLINE_DEPTH = 6;
const DELIMITER_WINDOW = 4000;

export const escapeMarkup = (text: string) => text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

const UNSAFE_URL_CHARACTERS = /[\s\\<>"'`\p{Cc}]/u;

export const safeLinkUrl = (value: string): string | null => {
    const url = value.trim();
    if (!url || url.length > 2048 || UNSAFE_URL_CHARACTERS.test(url)) return null;
    if (/^https?:\/\//i.test(url)) return URL.canParse(url) ? url : null;
    if (url.startsWith("//")) return null;
    if (/^(\/|#|\.\.?\/)/.test(url)) return url;
    return null;
};

export const safeImageUrl = (value: string, origins: string[] = []): string | null => {
    const url = value.trim();
    if (!url || url.length > 2048 || UNSAFE_URL_CHARACTERS.test(url)) return null;
    if (url.startsWith("/") && !url.startsWith("//")) return url;
    if (!/^https?:\/\//i.test(url) || !URL.canParse(url)) return null;
    const origin = new URL(url).origin;
    return origins.some((allowed) => URL.canParse(allowed) && new URL(allowed).origin === origin) ? url : null;
};

const isExternal = (url: string) => /^https?:\/\//i.test(url);

const PUNCTUATION = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/;

type InlineContext = { options: MarkdownOptions; depth: number; inLink: boolean };

const findClosingBracket = (text: string, start: number) => {
    let depth = 0;
    for (let i = start; i < text.length && i < start + DELIMITER_WINDOW; i++) {
        const c = text[i];
        if (c === "\\") {
            i++;
            continue;
        }
        if (c === "[") depth++;
        else if (c === "]") {
            if (depth === 0) return i;
            depth--;
        }
    }
    return -1;
};

const parseDestination = (text: string, start: number) => {
    if (text[start] !== "(") return null;
    let depth = 0;
    for (let i = start + 1; i < text.length && i < start + 2100; i++) {
        const c = text[i];
        if (c === "\\") {
            i++;
            continue;
        }
        if (c === "(") depth++;
        else if (c === ")") {
            if (depth === 0) {
                const inner = text.slice(start + 1, i).trim();
                const titled = /^(\S+)\s+"[^"]*"$/.exec(inner);
                return { url: titled ? titled[1] : inner, end: i + 1 };
            }
            depth--;
        }
    }
    return null;
};

const findCloser = (text: string, delimiter: string, from: number, wordBound: boolean) => {
    let index = from;
    const limit = from + DELIMITER_WINDOW;
    while (index < text.length && index < limit) {
        const found = text.indexOf(delimiter, index);
        if (found < 0 || found > limit) return -1;
        const before = text[found - 1];
        const after = text[found + delimiter.length];
        const flanking = before !== undefined && !/\s/.test(before);
        const bounded = !wordBound || after === undefined || !/[\p{L}\p{N}]/u.test(after);
        if (found > from && flanking && bounded) return found;
        index = found + 1;
    }
    return -1;
};

const AUTOLINK = /^https?:\/\/[^\s<>"'`]+/i;

const renderInline = (text: string, context: InlineContext): string => {
    if (context.depth > MAX_INLINE_DEPTH) return escapeMarkup(text);
    const nested = (inner: string, inLink = context.inLink) => renderInline(inner, { ...context, depth: context.depth + 1, inLink });
    let out = "";
    let i = 0;
    while (i < text.length) {
        const c = text[i];
        if (c === "\\" && i + 1 < text.length && PUNCTUATION.test(text[i + 1])) {
            out += escapeMarkup(text[i + 1]);
            i += 2;
            continue;
        }
        if (c === "`") {
            let run = 1;
            while (text[i + run] === "`") run++;
            const fence = "`".repeat(run);
            const close = text.indexOf(fence, i + run);
            if (close > 0) {
                out += `<code>${escapeMarkup(text.slice(i + run, close).trim())}</code>`;
                i = close + run;
                continue;
            }
            out += escapeMarkup(fence);
            i += run;
            continue;
        }
        if (c === "!" && text[i + 1] === "[") {
            const close = findClosingBracket(text, i + 2);
            const destination = close > 0 ? parseDestination(text, close + 1) : null;
            if (destination) {
                const alt = text.slice(i + 2, close);
                const src = safeImageUrl(destination.url, context.options.imageOrigins);
                out += src ? `<img src="${escapeMarkup(src)}" alt="${escapeMarkup(alt)}" loading="lazy" decoding="async">` : escapeMarkup(alt);
                i = destination.end;
                continue;
            }
        }
        if (c === "[" && !context.inLink) {
            const close = findClosingBracket(text, i + 1);
            const destination = close > 0 ? parseDestination(text, close + 1) : null;
            if (destination) {
                const label = nested(text.slice(i + 1, close), true);
                const href = safeLinkUrl(destination.url);
                out += href ? `<a href="${escapeMarkup(href)}"${isExternal(href) ? ' rel="nofollow noopener noreferrer"' : ""}>${label}</a>` : label;
                i = destination.end;
                continue;
            }
        }
        if (c === "<" && !context.inLink) {
            const close = text.indexOf(">", i);
            const candidate = close > 0 ? text.slice(i + 1, close) : "";
            if (AUTOLINK.test(candidate) && AUTOLINK.exec(candidate)?.[0] === candidate && safeLinkUrl(candidate)) {
                out += `<a href="${escapeMarkup(candidate)}" rel="nofollow noopener noreferrer">${escapeMarkup(candidate)}</a>`;
                i = close + 1;
                continue;
            }
        }
        if ((c === "h" || c === "H") && !context.inLink && (i === 0 || /[\s(]/.test(text[i - 1]))) {
            const match = AUTOLINK.exec(text.slice(i, i + 2100));
            if (match) {
                const url = match[0].replace(/[.,;:!?)\]]+$/, "");
                if (safeLinkUrl(url)) {
                    out += `<a href="${escapeMarkup(url)}" rel="nofollow noopener noreferrer">${escapeMarkup(url)}</a>`;
                    i += url.length;
                    continue;
                }
            }
        }
        if (c === "~" && text[i + 1] === "~") {
            const close = findCloser(text, "~~", i + 2, false);
            if (close > i + 2 && !/\s/.test(text[i + 2])) {
                out += `<del>${nested(text.slice(i + 2, close))}</del>`;
                i = close + 2;
                continue;
            }
        }
        if (c === "*" || c === "_") {
            const wordBound = c === "_";
            const opensWord = !wordBound || i === 0 || !/[\p{L}\p{N}]/u.test(text[i - 1]);
            const strong = text[i + 1] === c;
            const delimiter = strong ? c + c : c;
            const start = i + delimiter.length;
            if (opensWord && start < text.length && !/\s/.test(text[start])) {
                const close = findCloser(text, delimiter, start, wordBound);
                if (close > start) {
                    const tag = strong ? "strong" : "em";
                    out += `<${tag}>${nested(text.slice(start, close))}</${tag}>`;
                    i = close + delimiter.length;
                    continue;
                }
            }
            out += escapeMarkup(delimiter);
            i += delimiter.length;
            continue;
        }
        if (c === "\n") {
            const hardBreak = out.endsWith("  ") || out.endsWith("\\");
            out = hardBreak ? `${out.replace(/(?: {2,}|\\)$/, "")}<br>\n` : `${out.trimEnd()}\n`;
            i++;
            continue;
        }
        out += escapeMarkup(c);
        i++;
    }
    return out;
};

const LIST_ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])( +|$)(.*)$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+-]*)\s*$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}> ?(.*)$/;

const startsBlock = (line: string) => FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || LIST_ITEM.test(line);

const indentOf = (line: string) => line.length - line.trimStart().length;

type HeadingIds = Map<string, number>;

const headingId = (text: string, ids: HeadingIds) => {
    const base = slugify(text, 60) || "section";
    const seen = ids.get(base) ?? 0;
    ids.set(base, seen + 1);
    return seen ? `${base}-${seen + 1}` : base;
};

const renderBlocks = (lines: string[], options: MarkdownOptions, depth: number, ids: HeadingIds): string => {
    const inline = (text: string) => renderInline(text, { options, depth: 0, inLink: false });
    const out: string[] = [];
    let paragraph: string[] = [];
    const flush = () => {
        if (paragraph.length) out.push(`<p>${inline(paragraph.join("\n").trim())}</p>`);
        paragraph = [];
    };
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        if (!line.trim()) {
            flush();
            i++;
            continue;
        }
        const fence = FENCE.exec(line);
        if (fence) {
            flush();
            const marker = fence[1];
            const body: string[] = [];
            i++;
            while (i < lines.length && !new RegExp(`^ {0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}\\s*$`).test(lines[i])) body.push(lines[i++]);
            i++;
            const language = fence[2] ? ` class="language-${escapeMarkup(fence[2].toLowerCase())}"` : "";
            out.push(`<pre><code${language}>${escapeMarkup(body.join("\n"))}</code></pre>`);
            continue;
        }
        const heading = HEADING.exec(line);
        if (heading) {
            flush();
            const level = Math.min(heading[1].length + (options.headingOffset ?? 1), 6);
            const text = heading[2] ?? "";
            out.push(`<h${level} id="${escapeMarkup(headingId(text, ids))}">${inline(text)}</h${level}>`);
            i++;
            continue;
        }
        if (RULE.test(line) && !(paragraph.length && /^ {0,3}-+\s*$/.test(line))) {
            flush();
            out.push("<hr>");
            i++;
            continue;
        }
        if (QUOTE.test(line)) {
            flush();
            const quoted: string[] = [];
            while (i < lines.length && lines[i].trim() && QUOTE.test(lines[i])) quoted.push(QUOTE.exec(lines[i++])![1]);
            out.push(
                depth < MAX_BLOCK_DEPTH
                    ? `<blockquote>${renderBlocks(quoted, options, depth + 1, ids)}</blockquote>`
                    : `<blockquote><p>${inline(quoted.join("\n"))}</p></blockquote>`,
            );
            continue;
        }
        const item = LIST_ITEM.exec(line);
        if (item && (!paragraph.length || item[2] === "1." || item[2] === "1)" || /^[-*+]$/.test(item[2]))) {
            flush();
            const ordered = /\d/.test(item[2]);
            const start = ordered ? Number.parseInt(item[2], 10) : 1;
            const baseIndent = item[1].length;
            const items: string[][] = [];
            let loose = false;
            while (i < lines.length) {
                const current = LIST_ITEM.exec(lines[i]);
                if (!current || current[1].length !== baseIndent || /\d/.test(current[2]) !== ordered) break;
                const contentIndent = current[1].length + current[2].length + Math.max(current[3].length, 1);
                const content = [current[4]];
                i++;
                let blank = false;
                while (i < lines.length) {
                    const next = lines[i];
                    if (!next.trim()) {
                        blank = true;
                        content.push("");
                        i++;
                        continue;
                    }
                    if (indentOf(next) >= Math.min(contentIndent, baseIndent + 2)) {
                        if (blank) loose = true;
                        blank = false;
                        content.push(next.slice(Math.min(indentOf(next), contentIndent)));
                        i++;
                        continue;
                    }
                    if (!blank && !startsBlock(next)) {
                        content.push(next.trim());
                        i++;
                        continue;
                    }
                    break;
                }
                while (content.length && !content.at(-1)!.trim()) content.pop();
                items.push(content);
                const following = i < lines.length ? LIST_ITEM.exec(lines[i]) : null;
                if (blank && following && following[1].length === baseIndent && /\d/.test(following[2]) === ordered) loose = true;
            }
            const rendered = items.map((content) => {
                const body = depth < MAX_BLOCK_DEPTH ? renderBlocks(content, options, depth + 1, ids) : `<p>${inline(content.join("\n"))}</p>`;
                return `<li>${loose ? body : body.replace(/<p>([\s\S]*?)<\/p>/g, "$1")}</li>`;
            });
            const tag = ordered ? "ol" : "ul";
            out.push(`<${tag}${ordered && start !== 1 ? ` start="${start}"` : ""}>${rendered.join("")}</${tag}>`);
            continue;
        }
        paragraph.push(line);
        i++;
    }
    flush();
    return out.join("\n");
};

export const renderMarkdown = (source: string, options: MarkdownOptions = {}) => {
    const lines = source.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").replaceAll(String.fromCharCode(0), "\uFFFD").split("\n");
    return renderBlocks(lines, options, 0, new Map());
};

export const markdownText = (source: string) =>
    source
        .replace(/\r\n?/g, "\n")
        .replace(/^ {0,3}(`{3,}|~{3,}).*$/gm, "")
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/^ {0,3}(#{1,6}|>|[-*+]|\d{1,9}[.)])\s+/gm, "")
        .replace(/[*_~`#>]+/g, "")
        .replace(/\s+/g, " ")
        .trim();

export const SLUG_MAX_LENGTH = 80;

export const slugify = (text: string, maxLength = SLUG_MAX_LENGTH) =>
    text
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+/, "")
        .slice(0, maxLength)
        .replace(/-+$/, "");

export const isSlug = (value: string) => value.length <= SLUG_MAX_LENGTH && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);

export const uniqueSlug = async (wanted: string, fallback: string, taken: (slug: string) => Promise<boolean>) => {
    const base = slugify(wanted) || fallback;
    if (!(await taken(base))) return base;
    for (let suffix = 2; suffix < 1000; suffix++) {
        const candidate = `${base.slice(0, SLUG_MAX_LENGTH - String(suffix).length - 1).replace(/-+$/, "")}-${suffix}`;
        if (!(await taken(candidate))) return candidate;
    }
    return `${base.slice(0, SLUG_MAX_LENGTH - 14)}-${Date.now().toString(36)}`;
};
