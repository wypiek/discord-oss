import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ASSETS_FOLDER } from "./Constants";

export const STEAM_SKU_BASE = 8_000_000_000_000_000_000n;
export const STEAM_CATEGORY_SKU = STEAM_SKU_BASE.toString();
export const STEAM_ART_ORIGIN = "https://shared.fastly.steamstatic.com";
export const STEAM_ART_PATH = "/community_assets/images/items/";
export const STEAM_FRAMES_FILE = path.join(ASSETS_FOLDER, "steam-frames.json");

const STEAM_BANNER = "/assets/steam-frames/banner.svg";
const SNOWFLAKE_EPOCH = 1420070400000;
const IMAGE = /^[0-9a-f]{40}\.(?:png|apng|jpg|gif)$/;
const STYLES = {
    background_colors: [1779768, 2770782],
    button_colors: [1744895, 1744895],
    confetti_colors: [6733044, 1744895, 13158600, 2770782, 16777215],
};
const FREE = { country_prices: { country_code: "US", prices: [{ amount: 0, currency: "usd", exponent: 2 }] } };

export interface SteamFrameRecord {
    defid: number;
    appid: number;
    name: string;
    description?: string;
    animated: boolean;
    image: string;
    still: string;
    created: number;
}

export interface SteamFrame extends SteamFrameRecord {
    sku_id: string;
    asset: string;
    app: string;
}

export interface SteamFrameCatalog {
    apps: Record<string, string>;
    frames: SteamFrameRecord[];
}

type Index = { frames: SteamFrame[]; bySku: Map<string, SteamFrame>; byAsset: Map<string, SteamFrame> };

export const steamFrameSku = (defid: number) => (STEAM_SKU_BASE + BigInt(defid)).toString();

export const steamFrameAsset = (frame: Pick<SteamFrameRecord, "appid" | "image" | "still" | "animated">) =>
    `${frame.animated ? "a_" : ""}${crypto.createHash("md5").update(`${frame.appid}/${frame.image}/${frame.still}`).digest("hex")}`;

const valid = (frame: SteamFrameRecord) =>
    !!frame &&
    Number.isSafeInteger(frame.defid) &&
    frame.defid > 0 &&
    Number.isSafeInteger(frame.appid) &&
    frame.appid > 0 &&
    typeof frame.name === "string" &&
    !!frame.name &&
    IMAGE.test(frame.image) &&
    IMAGE.test(frame.still);

export function indexSteamFrames(catalog: SteamFrameCatalog): Index {
    const frames: SteamFrame[] = [];
    const bySku = new Map<string, SteamFrame>();
    const byAsset = new Map<string, SteamFrame>();
    for (const record of Array.isArray(catalog?.frames) ? catalog.frames : []) {
        if (!valid(record)) continue;
        const frame: SteamFrame = {
            ...record,
            animated: record.animated === true,
            sku_id: steamFrameSku(record.defid),
            asset: steamFrameAsset({ ...record, animated: record.animated === true }),
            app: catalog.apps?.[record.appid] ?? "Steam",
        };
        if (bySku.has(frame.sku_id)) continue;
        frames.push(frame);
        bySku.set(frame.sku_id, frame);
        byAsset.set(frame.asset, frame);
    }
    frames.sort((a, b) => b.created - a.created || b.defid - a.defid);
    return { frames, bySku, byAsset };
}

let index: Index | undefined;

const load = () => {
    if (index) return index;
    try {
        index = indexSteamFrames(JSON.parse(readFileSync(STEAM_FRAMES_FILE, "utf8")));
    } catch (error) {
        console.error("[SteamFrames] could not load steam-frames.json", error);
        index = indexSteamFrames({ apps: {}, frames: [] });
    }
    return index;
};

export const isSteamSku = (sku: string) => /^\d{19}$/.test(sku) && BigInt(sku) > STEAM_SKU_BASE && BigInt(sku) < STEAM_SKU_BASE + 1_000_000_000_000n;

export const steamFrameBySku = (sku: string) => (isSteamSku(sku) ? load().bySku.get(sku) : undefined);

export const steamFrameByAsset = (asset: string) => load().byAsset.get(asset.replace(/\.(?:png|gif|webp)$/, ""));

export const steamFrameArtUrl = (frame: SteamFrame, slot: "animated" | "static") =>
    `${STEAM_ART_ORIGIN}${STEAM_ART_PATH}${frame.appid}/${slot === "animated" ? frame.image : frame.still}`;

export const steamFrameRecency = (sku: string) => {
    const frame = steamFrameBySku(sku);
    return frame ? BigInt(Math.max(0, frame.created * 1000 - SNOWFLAKE_EPOCH)) << 22n : undefined;
};

export function steamFrameCategory(frames = load().frames) {
    const products = frames.map((frame) => ({
        sku_id: frame.sku_id,
        store_listing_id: frame.sku_id,
        name: frame.name,
        summary: frame.description ? `${frame.app}. ${frame.description}` : `An avatar frame from ${frame.app}.`,
        styles: STYLES,
        preview_assets: null,
        items: [{ type: 0, sku_id: frame.sku_id, asset: frame.asset, label: `${frame.name}, an avatar frame from ${frame.app}` }],
        type: 0,
        premium_type: 2,
        hide_badge: true,
        unpublished_at: null,
        category_sku_id: STEAM_CATEGORY_SKU,
        prices: { "0": FREE, "4": FREE },
        google_sku_ids: {},
        is_first_party: true,
        steam_app: frame.app,
    }));
    return {
        sku_id: STEAM_CATEGORY_SKU,
        name: "Steam",
        summary: "Avatar frames from the Steam Points Shop.",
        store_listing_id: STEAM_CATEGORY_SKU,
        styles: STYLES,
        hero_ranking: products.slice(0, 20).map((product) => product.sku_id),
        products,
        hero_banner_url: STEAM_BANNER,
        catalog_banner_url: STEAM_BANNER,
        featured_block_url: STEAM_BANNER,
        mobile_banner_url: STEAM_BANNER,
        logo_url: "/assets/steam-frames/logo.svg",
        hero_logo_url: "/assets/steam-frames/logo.svg",
        pdp_bg_url: null,
        mobile_bg_url: null,
        unpublished_at: null,
    };
}
