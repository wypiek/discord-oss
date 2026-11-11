import { writeFile } from "node:fs/promises";
import path from "node:path";

export const AVATAR_FRAME_CLASS = 14;
const API = "https://api.steampowered.com";
const PAGE_SIZE = 1000;
const MAX_PAGES = 10;
const APP_BATCH = 100;
const MAX_APP_BATCHES = 30;
const DELAY_MS = 1000;
const IMAGE = /^[0-9a-f]{40}\.(?:png|apng|jpg|gif)$/;

const FLAT_BLACK_BLOCKS = "flat black blocks with no other color, which read as black rectangles over the avatar on Discord's dark theme";
export const EXCLUDED_FRAMES = new Map([
    [4104240, FLAT_BLACK_BLOCKS],
    [4104243, FLAT_BLACK_BLOCKS],
    [4104244, `${FLAT_BLACK_BLOCKS}, and the still covers 35% of the avatar`],
    [4104245, `${FLAT_BLACK_BLOCKS}, and the still covers 32% of the avatar`],
]);

const text = (value, max) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined);

export function framesFromDefinitions(definitions) {
    const frames = new Map();
    for (const definition of definitions ?? []) {
        const data = definition?.community_item_data;
        const defid = Number(definition?.defid);
        const appid = Number(definition?.appid);
        if (definition?.community_item_class !== AVATAR_FRAME_CLASS || definition.active === false || !data) continue;
        if (!Number.isSafeInteger(defid) || defid <= 0 || !Number.isSafeInteger(appid) || appid <= 0) continue;
        if (EXCLUDED_FRAMES.has(defid)) continue;
        const image = IMAGE.test(data.item_image_small ?? "") ? data.item_image_small : undefined;
        const still = IMAGE.test(data.item_image_large ?? "") ? data.item_image_large : image;
        const name = text(data.item_title, 100) ?? text(data.item_name, 100);
        if (!image || !still || !name) continue;
        const description = text(data.item_description, 300);
        const created = Number(definition.timestamp_created);
        frames.set(defid, {
            defid,
            appid,
            name,
            ...(description && { description }),
            animated: data.animated === true && image !== still,
            image,
            still,
            created: Number.isSafeInteger(created) && created > 0 ? created : 0,
        });
    }
    return [...frames.values()].sort((a, b) => a.defid - b.defid);
}

export function appNamesFromItems(storeItems) {
    const names = {};
    for (const item of storeItems ?? []) {
        const appid = Number(item?.appid ?? item?.id);
        const name = text(item?.name, 100);
        if (Number.isSafeInteger(appid) && appid > 0 && name && item.success !== 2) names[appid] = name;
    }
    return names;
}

export function serializeCatalog(frames, names) {
    const used = [...new Set(frames.map((frame) => frame.appid))].sort((a, b) => a - b);
    const apps = Object.fromEntries(used.flatMap((appid) => (names[appid] ? [[String(appid), names[appid]]] : [])));
    const lines = frames.map((frame) => `    ${JSON.stringify(frame)}`);
    return `{\n  "apps": ${JSON.stringify(apps, null, 2).replace(/\n/g, "\n  ")},\n  "frames": [\n${lines.join(",\n")}\n  ]\n}\n`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`${url.split("?")[0]} answered ${response.status}`);
    return response.json();
}

async function fetchDefinitions() {
    const definitions = [];
    let cursor;
    for (let page = 0; page < MAX_PAGES; page++) {
        const query = new URLSearchParams({ count: String(PAGE_SIZE), language: "english", "community_item_classes[0]": String(AVATAR_FRAME_CLASS) });
        if (cursor) query.set("cursor", cursor);
        const { response } = await getJson(`${API}/ILoyaltyRewardsService/QueryRewardItems/v1/?${query}`);
        const found = response?.definitions ?? [];
        definitions.push(...found);
        console.log(`[steam-frames] page ${page + 1}: ${found.length} items, ${definitions.length} of ${response?.total_count ?? "?"}`);
        if (!found.length || !response.next_cursor || response.next_cursor === cursor || definitions.length >= (response.total_count ?? Number.POSITIVE_INFINITY)) break;
        cursor = response.next_cursor;
        await sleep(DELAY_MS);
    }
    return definitions;
}

async function fetchAppNames(appids) {
    const items = [];
    for (let index = 0, batch = 0; index < appids.length && batch < MAX_APP_BATCHES; index += APP_BATCH, batch++) {
        await sleep(DELAY_MS);
        const input = { ids: appids.slice(index, index + APP_BATCH).map((appid) => ({ appid })), context: { language: "english", country_code: "US" }, data_request: {} };
        const { response } = await getJson(`${API}/IStoreBrowseService/GetItems/v1/?${new URLSearchParams({ input_json: JSON.stringify(input) })}`);
        items.push(...(response?.store_items ?? []));
        console.log(`[steam-frames] app names: ${Math.min(index + APP_BATCH, appids.length)} of ${appids.length}`);
    }
    return appNamesFromItems(items);
}

if (import.meta.main) {
    const output = process.argv[2] ?? path.join(import.meta.dir, "..", "assets", "steam-frames.json");
    const frames = framesFromDefinitions(await fetchDefinitions());
    if (!frames.length) {
        console.error("[steam-frames] Steam returned no avatar frames, keeping the current catalog");
        process.exit(1);
    }
    const names = await fetchAppNames([...new Set(frames.map((frame) => frame.appid))].sort((a, b) => a - b));
    await writeFile(output, serializeCatalog(frames, names));
    console.log(`[steam-frames] wrote ${frames.length} frames from ${Object.keys(names).length} apps to ${output}`);
}
