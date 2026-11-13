const EXTRA_LINES = 30;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

type Open = { start: number; close: "$$" | "\\]" };

const withoutCode = (line: string) => line.replace(/`+[^`]*`+/g, "").replace(/\\\$/g, "");

function scan(line: string, index: number, open: Open | null): Open | null {
    let rest = withoutCode(line);
    let current = open;
    while (rest.length) {
        if (current) {
            const end = rest.indexOf(current.close);
            if (end === -1) return current;
            rest = rest.slice(end + current.close.length);
            current = null;
            continue;
        }
        const dollars = rest.indexOf("$$");
        const bracket = rest.indexOf("\\[");
        const candidates = [dollars, bracket].filter((position) => position !== -1);
        if (!candidates.length) return null;
        const start = Math.min(...candidates);
        const isDollars = start === dollars;
        current = { start: index, close: isDollars ? "$$" : "\\]" };
        rest = rest.slice(start + 2);
    }
    return current;
}

export function mathSafeLineCount(lines: string[] | undefined, wanted: number) {
    if (!lines || lines.length <= wanted) return wanted;
    let open: Open | null = null;
    let fence: string | null = null;
    const limit = Math.min(lines.length, wanted + EXTRA_LINES);
    for (let index = 0; index < limit; index++) {
        if (index >= wanted && !open) return index;
        const line = lines[index];
        const marker = FENCE.exec(line)?.[1];
        if (!open && marker && (!fence || marker[0] === fence[0])) {
            fence = fence ? null : marker;
            continue;
        }
        if (fence) continue;
        open = scan(line, index, open);
    }
    if (!open) return Math.max(wanted, limit);
    return open.start > 0 ? open.start : wanted;
}
