import { FederatedObject } from "@spacebar/database";
import { CollectibleItemType, CollectibleProduct, Collectibles, Config, parseCanonicalId, readRemoteDecorationItem, readRemoteProfileEffectItem } from "@spacebar/util";
import { homeCdnBase } from "./federationMedia";
import { signedFetch, trustFor } from "./federationNetwork";
import { freeProduct } from "./store";

const FOUND_TTL = 10 * 60_000;
const MISSING_TTL = 60_000;
const CACHE_LIMIT = 5000;

const cache = new Map<string, { at: number; product: CollectibleProduct | null }>();
const inflight = new Map<string, Promise<CollectibleProduct | null>>();

async function fetchRemoteProduct(sku: string) {
    const row = await FederatedObject.findOne({ where: { local_id: sku }, select: { canonical: true, instance: true } });
    const parsed = row ? parseCanonicalId(row.canonical) : null;
    if (!row || !parsed || !(await trustFor(row.instance).catch(() => null))) return null;
    const response = await signedFetch<Record<string, unknown>>(row.instance, "GET", `/federation/v2/collectibles/${encodeURIComponent(row.canonical)}`, undefined, 10_000);
    if (response.status !== 200) return null;
    const decoration = readRemoteDecorationItem(response.body, sku);
    if (decoration) return freeProduct({ sku_id: sku, name: decoration.label, summary: "", type: CollectibleItemType.AVATAR_DECORATION }, decoration);
    const item = readRemoteProfileEffectItem(response.body, parsed.id, sku, homeCdnBase());
    if (!item) return null;
    return freeProduct({ sku_id: sku, name: item.title, summary: item.description, type: CollectibleItemType.PROFILE_EFFECT }, item);
}

export async function remoteCollectibleProduct(sku: string) {
    if (!Config.get().federation.enabled || !/^\d{1,20}$/.test(sku)) return null;
    const cached = cache.get(sku);
    if (cached && Date.now() - cached.at < (cached.product ? FOUND_TTL : MISSING_TTL)) return cached.product;
    const pending = inflight.get(sku);
    if (pending) return pending;
    const task = fetchRemoteProduct(sku)
        .catch(() => null)
        .then((product) => {
            if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
            cache.set(sku, { at: Date.now(), product });
            return product;
        })
        .finally(() => inflight.delete(sku));
    inflight.set(sku, task);
    return task;
}

export async function remoteDecorationFor(instance: string, sku: string) {
    const row = await FederatedObject.findOne({ where: { local_id: sku }, select: { canonical: true, instance: true } });
    const parsed = row ? parseCanonicalId(row.canonical) : null;
    if (!row || !parsed || row.instance !== instance) return undefined;
    const item = (await remoteCollectibleProduct(sku))?.items[0];
    if (item?.type !== CollectibleItemType.AVATAR_DECORATION || !item.asset) return undefined;
    const own = await Collectibles.item(parsed.id, CollectibleItemType.AVATAR_DECORATION).catch(() => undefined);
    return { asset: item.asset, sku_id: own?.asset === item.asset ? parsed.id : sku };
}
