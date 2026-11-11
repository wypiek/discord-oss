import { HTTPError } from "lambert-server/HTTPError";

const SNOWFLAKE = /^\d{1,20}$/;
const MAX_SNOWFLAKE = 9223372036854775807n;

const single = (value: unknown, name: string) => {
    if (value === undefined) return undefined;
    if (typeof value !== "string") throw new HTTPError(`${name} must be supplied once as a string`, 400);
    return value;
};

export function snowflakeCursor(value: unknown, name: string) {
    const text = single(value, name);
    if (text === undefined || text === "") return undefined;
    if (!SNOWFLAKE.test(text) || BigInt(text) > MAX_SNOWFLAKE) throw new HTTPError(`${name} must be an ID`, 400);
    return text;
}

export function cursorLimit(value: unknown, fallback: number, max: number) {
    const text = single(value, "limit");
    if (text === undefined) return fallback;
    if (!/^\d{1,4}$/.test(text) || Number(text) < 1 || Number(text) > max) throw new HTTPError(`limit must be between 1 and ${max}`, 400);
    return Number(text);
}

export function searchText(value: unknown, max = 100) {
    const text = (single(value, "q") ?? "").trim();
    if (text.length > max) throw new HTTPError(`q must be no longer than ${max} characters`, 400);
    return text;
}

export const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, "\\$&")}%`;

export const MAX_LIST_OFFSET = 10000;

export function listOffset(value: unknown) {
    const text = single(value, "offset");
    if (text === undefined) return 0;
    if (!/^\d{1,9}$/.test(text)) throw new HTTPError("offset must be a non-negative integer", 400);
    if (Number(text) > MAX_LIST_OFFSET) throw new HTTPError(`offset can't pass ${MAX_LIST_OFFSET}. Page further with the next value of each page as after`, 400);
    return Number(text);
}

export const encodeCursor = (values: (string | number)[]) => Buffer.from(JSON.stringify(values)).toString("base64url");

export function decodeCursor(value: unknown, length: number) {
    const text = single(value, "after");
    if (text === undefined || text === "") return undefined;
    const fail = () => new HTTPError("after must be the next value of a previous page", 400);
    if (text.length > 512 || !/^[A-Za-z0-9_-]+$/.test(text)) throw fail();
    let values: unknown;
    try {
        values = JSON.parse(Buffer.from(text, "base64url").toString("utf8"));
    } catch {
        throw fail();
    }
    if (!Array.isArray(values) || values.length !== length || values.some((entry) => typeof entry !== "string" && typeof entry !== "number")) throw fail();
    return values as (string | number)[];
}

export function keysetClause(order: [string, "ASC" | "DESC"][], values: unknown[]) {
    const params: Record<string, unknown> = {};
    const build = (index: number): string => {
        const [column, direction] = order[index];
        const name = `keyset${index}`;
        params[name] = values[index];
        const compare = `${column} ${direction === "DESC" ? "<" : ">"} :${name}`;
        return index === order.length - 1 ? compare : `(${compare} OR (${column} = :${name} AND ${build(index + 1)}))`;
    };
    return { sql: build(0), params };
}

export function cursorPage<T>(rows: T[], limit: number, key: (row: T) => string) {
    const more = rows.length > limit;
    const page = more ? rows.slice(0, limit) : rows;
    return { page, next: more && page.length ? key(page[page.length - 1]) : null };
}
