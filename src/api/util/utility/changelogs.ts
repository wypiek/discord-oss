import { HTTPError } from "lambert-server/HTTPError";
import { Changelog } from "@spacebar/database";
import { instanceName } from "@spacebar/util";
import { siteImageUrl } from "./sitePages";

export const CHANGELOG_ASSET_YOUTUBE = 0;
export const CHANGELOG_ASSET_IMAGE = 1;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

export type ChangelogConfig = Record<string, { min_version: number; show_on_startup: boolean }>;

export const today = (now = new Date()) => now.toISOString().slice(0, 10);

export const parseChangelogDate = (value: string | undefined) => {
    if (value === undefined || value === "") return undefined;
    if (!DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)
        throw new HTTPError("Dates look like 2026-11-12", 400);
    return value;
};

export const parseYoutubeVideo = (value: string | null | undefined) => {
    if (value === undefined) return undefined;
    const text = value?.trim();
    if (!text) return null;
    if (YOUTUBE_ID.test(text)) return text;
    try {
        const url = new URL(text);
        const host = url.hostname.replace(/^www\.|^m\./, "");
        const id =
            host === "youtu.be"
                ? url.pathname.slice(1)
                : host === "youtube.com" || host === "youtube-nocookie.com"
                  ? (url.searchParams.get("v") ?? url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1])
                  : null;
        if (id && YOUTUBE_ID.test(id)) return id;
    } catch {}
    throw new HTTPError("Paste a YouTube link or an 11-character video id", 400);
};

const HEADING = /^ {0,3}#{1,6}\s/;
const LIST_ITEM = /^ {0,3}(?:[*+-]|\d{1,9}[.)])\s/;
const FENCE = /^ {0,3}(?:```|~~~)/;
const INDENTED = /^\s+\S/;

const isBlank = (line: string | undefined) => line === undefined || line.trim() === "";

export const normalizeChangelogMarkdown = (body: string) => {
    const out: string[] = [];
    let fenced = false;
    let inList: boolean = false;
    for (const line of body.replace(/\r\n?/g, "\n").split("\n")) {
        if (fenced) {
            out.push(line);
            if (FENCE.test(line)) {
                fenced = false;
                out.push("");
            }
            continue;
        }
        const previous = out[out.length - 1];
        if (isBlank(line)) {
            inList = false;
            out.push("");
            continue;
        }
        const heading = HEADING.test(line);
        const item = LIST_ITEM.test(line);
        const continuesList: boolean = inList && (item || INDENTED.test(line));
        const separate = FENCE.test(line) || heading || (previous !== undefined && HEADING.test(previous)) || (item && !inList) || (inList && !continuesList);
        if (separate && !isBlank(previous)) out.push("");
        if (FENCE.test(line)) {
            fenced = true;
            inList = false;
        } else inList = continuesList || item;
        out.push(line);
    }
    return `${out
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()}\n\n`;
};

const snowflake = (id: string) => BigInt(id);

export const visibleChangelogs = <T extends Pick<Changelog, "id" | "date" | "published">>(changelogs: T[], now = new Date()) =>
    changelogs
        .filter((changelog) => changelog.published && changelog.date <= today(now))
        .sort((a, b) => a.date.localeCompare(b.date) || (snowflake(a.id) < snowflake(b.id) ? -1 : 1));

export const changelogConfig = (changelogs: Pick<Changelog, "id" | "date" | "published" | "show_on_startup">[], now = new Date()): ChangelogConfig =>
    Object.fromEntries(visibleChangelogs(changelogs, now).map((changelog, index) => [changelog.id, { min_version: index + 1, show_on_startup: changelog.show_on_startup }]));

export const changelogDocument = (changelog: Pick<Changelog, "date" | "body" | "image" | "youtube_video_id">, locale: string) => {
    const video = changelog.youtube_video_id || null;
    const image = !video && changelog.image ? siteImageUrl(changelog.image) : null;
    return {
        date: changelog.date,
        locale,
        content: normalizeChangelogMarkdown(changelog.body.replaceAll("{instance}", instanceName())),
        asset: video ?? image ?? "",
        asset_type: video ? CHANGELOG_ASSET_YOUTUBE : CHANGELOG_ASSET_IMAGE,
    };
};

export const serializeChangelog = (changelog: Changelog, now = new Date()) => ({
    id: changelog.id,
    title: changelog.title,
    date: changelog.date,
    body: changelog.body,
    image: changelog.image ?? null,
    image_url: changelog.image ? siteImageUrl(changelog.image) : null,
    youtube_video_id: changelog.youtube_video_id ?? null,
    published: changelog.published,
    scheduled: changelog.published && changelog.date > today(now),
    show_on_startup: changelog.show_on_startup,
    created_at: changelog.created_at,
    updated_at: changelog.updated_at,
});
