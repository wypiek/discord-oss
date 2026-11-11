import { parseCanonicalId } from "./Protocol";

export const DECORATION_FIELD = "avatar_decoration_data";
export const COLLECTIBLES_FIELD = "collectibles";
export const EFFECT_FIELD = "profile_effect";
export const DECORATION_ASSET = /^(?:a_)?[0-9a-f]{32}$/;
export const NAMEPLATE_ASSET = /^nameplates\/(?:[^/\s?#\\]{1,128}\/){1,4}$/;
export const NAMEPLATE_PALETTE = /^[a-z_]{1,32}$/;
export const DECORATION_ART_MAX_BYTES = 10 * 1024 * 1024;

export const RemoteCollectibleType = {
    AVATAR_DECORATION: 0,
    PROFILE_EFFECT: 1,
    NAMEPLATE: 2,
    PROFILE_FRAME: 3,
} as const;

const SKU = /^\d{1,20}$/;
const MAX_DEPTH = 64;
const MAX_PROFILE_COLLECTIBLES = 8;
const WATCHED_FIELDS = [DECORATION_FIELD, COLLECTIBLES_FIELD, EFFECT_FIELD];

export interface DecorationData {
    asset: string;
    sku_id: string;
    expires_at: number | string | null;
}

export interface NameplateData {
    asset: string;
    sku_id: string;
    label: string;
    palette: string;
    expires_at: number | string | null;
}

export interface ProfileEffectData {
    id: string;
    expires_at: number | string | null;
}

export interface ProfileCollectibleData {
    sku_id: string;
    type: number;
    expires_at: number | string | null;
}

export interface RemoteDecorationRef {
    sku: string;
    asset: string;
    type?: number;
    instance?: string;
}

export const decorationKey = (ref: RemoteDecorationRef) => `${ref.type ?? RemoteCollectibleType.AVATAR_DECORATION}:${ref.instance ?? ""}:${ref.sku}:${ref.asset}`;

export type DecorationSkuResolver = (wanted: RemoteDecorationRef[]) => Promise<Map<string, string>>;

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

const liveExpiry = (value: unknown, now: number): number | string | null | undefined => {
    if (value === null || value === undefined) return null;
    const at =
        typeof value === "number" && Number.isSafeInteger(value) && value > 0
            ? value < 1e11
                ? value * 1000
                : value
            : typeof value === "string" && value.length <= 64
              ? Date.parse(value)
              : Number.NaN;
    if (Number.isNaN(at) || at <= now) return undefined;
    return value as number | string;
};

export const readDecoration = (value: unknown, now = Date.now()): DecorationData | null => {
    if (!isObject(value)) return null;
    const { asset, sku_id, expires_at } = value;
    if (typeof asset !== "string" || !DECORATION_ASSET.test(asset) || typeof sku_id !== "string" || !SKU.test(sku_id)) return null;
    const expiry = liveExpiry(expires_at, now);
    return expiry === undefined ? null : { asset, sku_id, expires_at: expiry };
};

export const readNameplate = (value: unknown, now = Date.now()): NameplateData | null => {
    if (!isObject(value)) return null;
    const { asset, sku_id, label, palette, expires_at } = value;
    if (typeof asset !== "string" || !NAMEPLATE_ASSET.test(asset) || asset.includes("/../") || typeof sku_id !== "string" || !SKU.test(sku_id)) return null;
    if (typeof palette !== "string" || !NAMEPLATE_PALETTE.test(palette)) return null;
    const expiry = liveExpiry(expires_at, now);
    if (expiry === undefined) return null;
    return { asset, sku_id, label: typeof label === "string" ? label.slice(0, 256) : "", palette, expires_at: expiry };
};

export const readProfileEffect = (value: unknown, now = Date.now()): ProfileEffectData | null => {
    if (!isObject(value) || typeof value.id !== "string" || !SKU.test(value.id)) return null;
    const expiry = liveExpiry(value.expires_at, now);
    return expiry === undefined ? null : { id: value.id, expires_at: expiry };
};

const readProfileCollectible = (value: Record<string, unknown>, now: number): ProfileCollectibleData | null => {
    const { sku_id, type } = value;
    if (typeof sku_id !== "string" || !SKU.test(sku_id) || (type !== RemoteCollectibleType.PROFILE_EFFECT && type !== RemoteCollectibleType.PROFILE_FRAME)) return null;
    const expiry = liveExpiry(value.expires_at, now);
    return expiry === undefined ? null : { sku_id, type, expires_at: expiry };
};

export const readCollectibles = (value: unknown, now = Date.now()) => (isObject(value) ? { nameplate: readNameplate(value.nameplate, now) } : null);

export const remoteSkuOrigin = (value: unknown, sender: string) => {
    if (typeof value !== "string") return null;
    if (SKU.test(value)) return { sku: value, instance: sender };
    const parsed = parseCanonicalId(value);
    return parsed && SKU.test(parsed.id) ? { sku: parsed.id, instance: parsed.instance } : null;
};

export const remoteDecorationSku = (value: unknown, sender: string) => {
    const origin = remoteSkuOrigin(value, sender);
    return origin?.instance === sender ? origin.sku : null;
};

interface Sourced<T> {
    data: T;
    instance: string;
}

const sourced = <T>(value: unknown, key: string, sender: string, read: (raw: Record<string, unknown>) => T | null): Sourced<T> | null => {
    if (!isObject(value)) return null;
    const origin = remoteSkuOrigin(value[key], sender);
    const data = origin ? read({ ...value, [key]: origin.sku }) : null;
    return origin && data ? { data, instance: origin.instance } : null;
};

const fromSender = <T>(found: Sourced<T> | null, sender: string) => (found?.instance === sender ? found.data : null);

export const readRemoteDecoration = (value: unknown, sender: string, now = Date.now()) =>
    fromSender(
        sourced(value, "sku_id", sender, (raw) => readDecoration(raw, now)),
        sender,
    );

export const readRemoteNameplate = (value: unknown, sender: string, now = Date.now()) =>
    fromSender(
        sourced(value, "sku_id", sender, (raw) => readNameplate(raw, now)),
        sender,
    );

export const customNameplateAsset = (sku: string) => `nameplates/custom/${sku}/`;

const collectibleHolders = (value: unknown) => {
    const holders: Record<string, unknown>[] = [];
    const visit = (node: unknown, depth: number) => {
        if (depth > MAX_DEPTH) return;
        if (Array.isArray(node)) {
            for (const entry of node) visit(entry, depth + 1);
            return;
        }
        if (!isObject(node)) return;
        if (WATCHED_FIELDS.some((key) => Object.hasOwn(node, key))) holders.push(node);
        for (const [key, child] of Object.entries(node)) if (!WATCHED_FIELDS.includes(key) && child && typeof child === "object") visit(child, depth + 1);
    };
    visit(value, 0);
    return holders;
};

interface HolderCollectibles {
    decoration: Sourced<DecorationData> | null;
    nameplate: Sourced<NameplateData> | null;
    effect: Sourced<ProfileEffectData> | null;
    profile: Sourced<ProfileCollectibleData>[];
}

const readHolder = (holder: Record<string, unknown>, sender: string, now: number): HolderCollectibles => {
    const collectibles = holder[COLLECTIBLES_FIELD];
    return {
        decoration: sourced(holder[DECORATION_FIELD], "sku_id", sender, (raw) => readDecoration(raw, now)),
        nameplate: isObject(collectibles) ? sourced(collectibles.nameplate, "sku_id", sender, (raw) => readNameplate(raw, now)) : null,
        effect: sourced(holder[EFFECT_FIELD], "id", sender, (raw) => readProfileEffect(raw, now)),
        profile: Array.isArray(collectibles)
            ? collectibles.slice(0, MAX_PROFILE_COLLECTIBLES).flatMap((entry) => sourced(entry, "sku_id", sender, (raw) => readProfileCollectible(raw, now)) ?? [])
            : [],
    };
};

const decorationRef = (found: Sourced<DecorationData>) => ({
    sku: found.data.sku_id,
    asset: found.data.asset,
    type: RemoteCollectibleType.AVATAR_DECORATION,
    instance: found.instance,
});
const nameplateRef = (found: Sourced<NameplateData>) => ({ sku: found.data.sku_id, asset: found.data.asset, type: RemoteCollectibleType.NAMEPLATE, instance: found.instance });
const effectRef = (found: Sourced<ProfileEffectData>) => ({ sku: found.data.id, asset: "", type: RemoteCollectibleType.PROFILE_EFFECT, instance: found.instance });
const profileRef = (found: Sourced<ProfileCollectibleData>) => ({ sku: found.data.sku_id, asset: "", type: found.data.type, instance: found.instance });

const refsOf = ({ decoration, nameplate, effect, profile }: HolderCollectibles): RemoteDecorationRef[] => [
    ...(decoration ? [decorationRef(decoration)] : []),
    ...(nameplate ? [nameplateRef(nameplate)] : []),
    ...(effect ? [effectRef(effect)] : []),
    ...profile.map(profileRef),
];

export async function localizeDecorations<T>(value: T, sender: string, resolve: DecorationSkuResolver, now = Date.now()): Promise<T> {
    const holders = collectibleHolders(value);
    if (!holders.length) return value;
    const parsed = holders.map((holder) => readHolder(holder, sender, now));
    const wanted = new Map(parsed.flatMap((entry) => refsOf(entry).map((ref) => [decorationKey(ref), ref] as const)));
    const local = wanted.size ? await resolve([...wanted.values()]).catch(() => new Map<string, string>()) : new Map<string, string>();
    const localSku = (ref: RemoteDecorationRef) => {
        const found = local.get(decorationKey(ref));
        return found && SKU.test(found) ? found : null;
    };
    holders.forEach((holder, index) => {
        const { decoration, nameplate, effect, profile } = parsed[index];
        if (Object.hasOwn(holder, DECORATION_FIELD)) {
            const sku_id = decoration && localSku(decorationRef(decoration));
            holder[DECORATION_FIELD] = decoration && sku_id ? { ...decoration.data, sku_id } : null;
        }
        if (Object.hasOwn(holder, EFFECT_FIELD)) {
            const id = effect && localSku(effectRef(effect));
            holder[EFFECT_FIELD] = effect && id ? { ...effect.data, id } : null;
        }
        if (!Object.hasOwn(holder, COLLECTIBLES_FIELD)) return;
        const collectibles = holder[COLLECTIBLES_FIELD];
        if (Array.isArray(collectibles)) {
            holder[COLLECTIBLES_FIELD] = profile.flatMap((entry) => {
                const sku_id = localSku(profileRef(entry));
                return sku_id ? [{ ...entry.data, sku_id }] : [];
            });
            return;
        }
        if (!isObject(collectibles)) {
            holder[COLLECTIBLES_FIELD] = null;
            return;
        }
        const sku_id = nameplate && localSku(nameplateRef(nameplate));
        const plate = nameplate?.data;
        holder[COLLECTIBLES_FIELD] = {
            nameplate: plate && sku_id ? { ...plate, sku_id, asset: sku_id === plate.sku_id ? plate.asset : customNameplateAsset(sku_id) } : null,
        };
    });
    return value;
}

const skuSlots = (value: unknown) =>
    collectibleHolders(value).flatMap((holder) => {
        const decoration = holder[DECORATION_FIELD];
        const effect = holder[EFFECT_FIELD];
        const collectibles = holder[COLLECTIBLES_FIELD];
        const slots: [Record<string, unknown>, string][] = [];
        if (isObject(decoration)) slots.push([decoration, "sku_id"]);
        if (isObject(effect)) slots.push([effect, "id"]);
        if (isObject(collectibles) && isObject(collectibles.nameplate)) slots.push([collectibles.nameplate, "sku_id"]);
        if (Array.isArray(collectibles)) for (const entry of collectibles) if (isObject(entry)) slots.push([entry, "sku_id"]);
        return slots.filter(([slot, key]) => typeof slot[key] === "string" && SKU.test(slot[key]));
    });

export const collectibleSkus = (value: unknown) => new Set(skuSlots(value).map(([slot, key]) => slot[key] as string));

export function canonicalizeDecorations<T>(value: T, canonical: Map<string, string>, own: string): T {
    for (const [slot, key] of skuSlots(value)) {
        const local = slot[key] as string;
        const origin = canonical.get(local);
        const parsed = parseCanonicalId(origin);
        if (!parsed || parsed.instance === own) continue;
        slot[key] = origin;
        if (slot.asset === customNameplateAsset(local)) slot.asset = customNameplateAsset(parsed.id);
    }
    return value;
}

const EFFECT_ART = /^\/media\/v1\/collectibles-shop\/(\d{1,20})\/(effect|thumbnail|reduced|static|animated)$/;
const CONTENT_ASSET = /^\/(?:content-assets|assets\/content)\/([0-9a-f]{32,64}(?:\.[a-z0-9]{2,6})?)$/i;
const ART_VERSION = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_EFFECT_LAYERS = 16;

export const localEffectArt = (value: unknown, remoteSku: string, localSku: string, cdnBase: string) => {
    if (typeof value !== "string" || value.length > 2048 || !URL.canParse(value)) return null;
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const cdn = cdnBase.replace(/\/+$/, "");
    const custom = EFFECT_ART.exec(url.pathname);
    if (custom) {
        if (custom[1] !== remoteSku) return null;
        const version = url.searchParams.get("v");
        return `${cdn}/media/v1/collectibles-shop/${localSku}/${custom[2]}${version && ART_VERSION.test(version) ? `?v=${version}` : ""}`;
    }
    const content = CONTENT_ASSET.exec(url.pathname);
    return content ? `${cdn}/content-assets/${content[1]}` : null;
};

const boundedInt = (value: unknown, min: number, max: number, fallback: number) =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback;

const boundedText = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : null);

export const readRemoteProfileEffectItem = (raw: unknown, remoteSku: string, localSku: string, cdnBase: string) => {
    if (!isObject(raw) || !isObject(raw.item) || raw.item.type !== RemoteCollectibleType.PROFILE_EFFECT || !SKU.test(localSku)) return null;
    const { item } = raw;
    const art = (value: unknown) => localEffectArt(value, remoteSku, localSku, cdnBase);
    const effects = (Array.isArray(item.effects) ? item.effects.slice(0, MAX_EFFECT_LAYERS) : []).flatMap((layer) => {
        if (!isObject(layer)) return [];
        const src = art(layer.src);
        if (!src) return [];
        const position = isObject(layer.position) ? layer.position : {};
        return [
            {
                src,
                loop: layer.loop === true,
                height: boundedInt(layer.height, 1, 4096, 880),
                width: boundedInt(layer.width, 1, 4096, 450),
                duration: boundedInt(layer.duration, 0, 600_000, 3000),
                start: boundedInt(layer.start, 0, 600_000, 0),
                loopDelay: boundedInt(layer.loopDelay, 0, 600_000, 0),
                position: { x: boundedInt(position.x, -4096, 4096, 0), y: boundedInt(position.y, -4096, 4096, 0) },
                zIndex: boundedInt(layer.zIndex, 0, 10_000, 100),
                randomizedSources: [],
            },
        ];
    });
    if (!effects.length) return null;
    const title = boundedText(item.title, 100) || boundedText(raw.name, 100) || "Profile effect";
    const thumbnail = art(item.thumbnailPreviewSrc) ?? effects[0].src;
    const staticFrame = art(item.staticFrameSrc);
    return {
        type: RemoteCollectibleType.PROFILE_EFFECT,
        id: localSku,
        sku_id: localSku,
        title,
        description: boundedText(item.description, 300) ?? "",
        accessibilityLabel: boundedText(item.accessibilityLabel, 300) || title,
        animationType: boundedInt(item.animationType, 0, 16, 2),
        thumbnailPreviewSrc: thumbnail,
        reducedMotionSrc: art(item.reducedMotionSrc) ?? thumbnail,
        ...(staticFrame && { staticFrameSrc: staticFrame }),
        effects,
    };
};

export const readRemoteDecorationItem = (raw: unknown, localSku: string) => {
    if (!isObject(raw) || !isObject(raw.item) || raw.item.type !== RemoteCollectibleType.AVATAR_DECORATION || !SKU.test(localSku)) return null;
    const { asset, label } = raw.item;
    if (typeof asset !== "string" || !DECORATION_ASSET.test(asset)) return null;
    return {
        type: RemoteCollectibleType.AVATAR_DECORATION,
        sku_id: localSku,
        asset,
        label: boundedText(label, 300) || boundedText(raw.name, 100) || "Avatar decoration",
    };
};
