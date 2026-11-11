export const DISCOVERY_MAX_KEYWORDS = 10;
export const DISCOVERY_KEYWORD_LENGTH = 30;
export const DISCOVERY_MAX_CATEGORIES = 5;
export const DISCOVERY_TERM_LENGTH = 32;
export const DISCOVERY_MAX_TERMS = 120;
export const DISCOVERY_QUERY_WORDS = 6;
export const DISCOVERY_QUERY_LENGTH = 100;
export const DISCOVERY_ACTIVE_WINDOW = 30 * 24 * 60 * 60 * 1000;

export const DiscoveryTermWeight = { exact: 4, name: 3, keyword: 2, description: 1, category: 0 } as const;

const EXACT_PREFIX = "=";
const CATEGORY_PREFIX = "#";
const EXACT_LENGTH = 96;

export const discoveryWords = (text: unknown) => {
    if (typeof text !== "string") return [];
    return text
        .normalize("NFKD")
        .replace(/\p{M}+/gu, "")
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean)
        .map((word) => [...word].slice(0, DISCOVERY_TERM_LENGTH).join(""));
};

export const discoveryExactTerm = (text: unknown) => {
    const words = discoveryWords(text);
    return words.length ? `${EXACT_PREFIX}${[...words.join(" ")].slice(0, EXACT_LENGTH).join("")}` : null;
};

export const discoveryCategoryTerm = (id: number) => `${CATEGORY_PREFIX}${id}`;

export const discoveryKeywords = (raw: unknown) => {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const keywords: string[] = [];
    for (const value of raw) {
        if (typeof value !== "string") continue;
        const keyword = [...value.trim().replace(/\s+/g, " ")].slice(0, DISCOVERY_KEYWORD_LENGTH).join("");
        const key = keyword.toLowerCase();
        if (!keyword || seen.has(key)) continue;
        seen.add(key);
        keywords.push(keyword);
        if (keywords.length === DISCOVERY_MAX_KEYWORDS) break;
    }
    return keywords;
};

export const discoveryCategoryIds = (raw: unknown) => {
    const values = Array.isArray(raw) ? raw : [raw];
    const ids: number[] = [];
    for (const value of values) {
        const id = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
        if (!Number.isInteger(id) || id < 0 || id > 32767 || ids.includes(id)) continue;
        ids.push(id);
        if (ids.length === DISCOVERY_MAX_CATEGORIES) break;
    }
    return ids;
};

export interface DiscoveryDocument {
    name: string;
    description?: string | null;
    keywords?: string[] | null;
    category_ids?: number[] | null;
}

export interface DiscoveryTermRow {
    term: string;
    weight: number;
}

export const discoveryTerms = (document: DiscoveryDocument): DiscoveryTermRow[] => {
    const terms = new Map<string, number>();
    const add = (term: string, weight: number) => {
        if ((terms.get(term) ?? -1) < weight) terms.set(term, weight);
    };
    const exact = discoveryExactTerm(document.name);
    if (exact) add(exact, DiscoveryTermWeight.exact);
    for (const word of discoveryWords(document.name)) add(word, DiscoveryTermWeight.name);
    for (const word of discoveryKeywords(document.keywords).flatMap(discoveryWords)) add(word, DiscoveryTermWeight.keyword);
    for (const word of discoveryWords((document.description ?? "").slice(0, 1000))) add(word, DiscoveryTermWeight.description);
    const categories = discoveryCategoryIds(document.category_ids ?? []).map(discoveryCategoryTerm);
    const words = [...terms]
        .sort((a, b) => b[1] - a[1])
        .slice(0, DISCOVERY_MAX_TERMS - categories.length)
        .map(([term, weight]) => ({ term, weight }));
    return [...words, ...categories.map((term) => ({ term, weight: DiscoveryTermWeight.category }))];
};

export const sameDiscoveryTerms = (a: DiscoveryTermRow[], b: DiscoveryTermRow[]) => {
    if (a.length !== b.length) return false;
    const map = new Map(a.map((row) => [row.term, row.weight]));
    return b.every((row) => map.get(row.term) === row.weight);
};

export interface DiscoveryQuery {
    words: string[];
    exact: string | null;
}

export const discoveryQuery = (raw: unknown): DiscoveryQuery => {
    const text = typeof raw === "string" ? raw.slice(0, DISCOVERY_QUERY_LENGTH) : "";
    const words = [...new Set(discoveryWords(text))].slice(0, DISCOVERY_QUERY_WORDS);
    return { words, exact: words.length ? discoveryExactTerm(text) : null };
};

export const discoveryPrefixRange = (word: string): [string, string] => {
    const points = [...word];
    const last = points.pop() ?? "";
    const next = (last.codePointAt(0) ?? 0) + 1;
    return [word, `${points.join("")}${String.fromCodePoint(next > 0x10ffff ? 0x10ffff : next)}`];
};

export interface RankedDiscoveryEntry {
    id: string;
    exact: boolean;
    weight?: number;
    member_count: number;
    active_at: number | null;
}

export const isRecentlyActive = (activeAt: number | null, now = Date.now()) => activeAt != null && now - activeAt <= DISCOVERY_ACTIVE_WINDOW;

export const compareDiscovery =
    (now = Date.now()) =>
    (a: RankedDiscoveryEntry, b: RankedDiscoveryEntry) =>
        Number(b.exact) - Number(a.exact) ||
        (b.weight ?? 0) - (a.weight ?? 0) ||
        Number(isRecentlyActive(b.active_at, now)) - Number(isRecentlyActive(a.active_at, now)) ||
        b.member_count - a.member_count ||
        (b.active_at ?? 0) - (a.active_at ?? 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export interface LocalDiscoveryGuild {
    features: string[];
    discovery_excluded?: boolean | null;
}

export const isLocallyDiscoverable = (guild: LocalDiscoveryGuild, showAllGuilds: boolean) =>
    !guild.discovery_excluded && (showAllGuilds || guild.features.includes("DISCOVERABLE"));
