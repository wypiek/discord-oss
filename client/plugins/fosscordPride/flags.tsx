import { RestAPI, Tooltip, UserStore, useEffect, useState, useStateFromStores } from "@webpack/common";

export type CatalogFlag = { slug: string; description: string; icon_url: string };
type FlagCarrier = { prideBadges?: unknown; pride_badges?: unknown } | null | undefined;

const MAX_STORED = 128;
const MAX_INTERNED = 1024;
const EMPTY: readonly string[] = Object.freeze([]);
const interned = new Map<string, readonly string[]>();

export function internFlags(value: unknown): readonly string[] {
    if (!Array.isArray(value) || !value.length) return EMPTY;
    const flags = [...new Set(value.filter((slug): slug is string => typeof slug === "string" && slug.length > 0 && slug.length <= 64))].slice(0, MAX_STORED);
    if (!flags.length) return EMPTY;
    const key = flags.join("\n");
    const known = interned.get(key);
    if (known) return known;
    const frozen = Object.freeze(flags);
    if (interned.size < MAX_INTERNED) interned.set(key, frozen);
    return frozen;
}

export const flagsFrom = (raw: FlagCarrier) => internFlags(raw?.prideBadges !== undefined ? raw.prideBadges : raw?.pride_badges);

const storedFlags = (userId: string | undefined): readonly string[] => {
    const value = userId ? (UserStore.getUser(userId) as FlagCarrier)?.prideBadges : undefined;
    return Array.isArray(value) ? value : EMPTY;
};

export function prepareUser(raw: FlagCarrier) {
    if (!raw || raw.pride_badges === undefined) return;
    raw.prideBadges = internFlags(raw.pride_badges);
    delete raw.pride_badges;
}

export const resolveFlags = (slugs: readonly string[] | null | undefined, catalog: ReadonlyMap<string, CatalogFlag>) =>
    [...new Set(slugs ?? [])].flatMap((slug) => {
        const flag = catalog.get(slug);
        return flag ? [flag] : [];
    });

let catalog: ReadonlyMap<string, CatalogFlag> | null = null;
let loading: Promise<void> | null = null;
let failedAt = 0;
const listeners = new Set<() => void>();
const RETRY_AFTER = 60_000;

function loadCatalog() {
    if (catalog || loading || Date.now() - failedAt < RETRY_AFTER) return;
    loading = RestAPI.get({ url: "/auth/pride-badges" })
        .then(({ body }: { body: { badges: CatalogFlag[] } }) => {
            catalog = new Map(body.badges.map((flag) => [flag.slug, flag]));
            for (const listener of listeners) listener();
        })
        .catch(() => {
            failedAt = Date.now();
        })
        .finally(() => {
            loading = null;
        });
}

function useCatalog(wanted: boolean) {
    const [current, setCurrent] = useState(catalog);
    useEffect(() => {
        if (!wanted) return;
        const update = () => setCurrent(catalog);
        listeners.add(update);
        update();
        loadCatalog();
        return () => {
            listeners.delete(update);
        };
    }, [wanted]);
    return current;
}

export function PrideFlags({ userId, max, className }: { userId?: string; max: number; className?: string }) {
    const slugs = useStateFromStores([UserStore], () => storedFlags(userId));
    const known = useCatalog(slugs.length > 0);
    if (!known || !slugs.length) return null;
    const flags = resolveFlags(slugs, known);
    if (!flags.length) return null;
    const shown = flags.length > max ? flags.slice(0, max - 1) : flags;
    const hidden = flags.length - shown.length;
    const names = flags.map((flag) => flag.description);
    return (
        <span className={className ? `fosscord-pride-flags ${className}` : "fosscord-pride-flags"} role="group" aria-label="Pride flags">
            {shown.map((flag) => (
                <Tooltip key={flag.slug} text={flag.description}>
                    {(props: Record<string, unknown>) => (
                        <img {...props} className="fosscord-pride-flag" src={flag.icon_url} alt={flag.description} draggable={false} loading="lazy" />
                    )}
                </Tooltip>
            ))}
            {hidden > 0 && (
                <Tooltip text={names.join(", ")}>
                    {(props: Record<string, unknown>) => (
                        <span {...props} className="fosscord-pride-more" role="img" aria-label={`${hidden} more: ${names.slice(shown.length).join(", ")}`}>
                            +{hidden}
                        </span>
                    )}
                </Tooltip>
            )}
        </span>
    );
}
