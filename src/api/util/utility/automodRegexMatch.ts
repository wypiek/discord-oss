export type RegexPatternMatch = { pattern: string; match: string };

export function matchRegexPatterns(content: string, patterns: string[]) {
    const matches: RegexPatternMatch[] = [];
    for (const pattern of patterns) {
        let regex: RegExp;
        try {
            regex = new RegExp(pattern, "iu");
        } catch {
            continue;
        }
        const found = content.match(regex);
        if (found?.[0]) matches.push({ pattern, match: found[0] });
    }
    return matches;
}
