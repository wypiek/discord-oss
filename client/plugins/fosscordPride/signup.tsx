import { RestAPI, useEffect, useState } from "@webpack/common";

type PublicBadge = {
    slug: string;
    id: string;
    description: string;
    icon_url: string;
    aliases?: string[];
};
type Catalog = { max_selections: number; badges: PublicBadge[] };

const COLLAPSED_COUNT = 24;
let signupSelection: string[] = [];

export const matches = (badge: { slug: string; description: string; aliases?: string[] }, query: string) => {
    const needle = query.trim().toLowerCase();
    return [badge.description, badge.slug.replaceAll("-", " "), ...(badge.aliases ?? [])].some((text) => text.toLowerCase().includes(needle));
};

export const takeSignupSelection = () => (signupSelection.length ? [...signupSelection] : undefined);

export function SignupPridePicker() {
    const [catalog, setCatalog] = useState<Catalog | null>(null);
    const [failed, setFailed] = useState(false);
    const [selected, setSelected] = useState<string[]>(signupSelection);
    const [query, setQuery] = useState("");
    const [pointed, setPointed] = useState<PublicBadge | null>(null);
    const [expanded, setExpanded] = useState(false);
    useEffect(() => {
        let active = true;
        RestAPI.get({ url: "/auth/pride-badges" })
            .then(({ body }: { body: Catalog }) => {
                if (!active) return;
                setCatalog(body);
                setSelected((current) => current.filter((slug) => body.badges.some((badge) => badge.slug === slug)));
            })
            .catch(() => {
                if (active) setFailed(true);
            });
        return () => {
            active = false;
        };
    }, []);
    useEffect(() => {
        signupSelection = selected;
    }, [selected]);
    if (failed)
        return (
            <section className="fosscord-pride-signup" aria-label="Pride flags">
                <p className="fosscord-pride-signup-hint">Pride flags could not load. You can add them later in Profiles settings.</p>
            </section>
        );
    if (!catalog) return null;
    const found = catalog.badges.filter((badge) => matches(badge, query));
    const collapsible = !query.trim() && catalog.badges.length > COLLAPSED_COUNT;
    const visible = collapsible && !expanded ? found.slice(0, COLLAPSED_COUNT) : found;
    const full = selected.length >= catalog.max_selections;
    const names = catalog.badges.filter((badge) => selected.includes(badge.slug)).map((badge) => badge.description);
    return (
        <section className="fosscord-pride-signup" aria-labelledby="fosscord-pride-signup-title" aria-describedby="fosscord-pride-signup-hint">
            <div className="fosscord-pride-signup-label">
                <span id="fosscord-pride-signup-title">Pride flags</span>
                <span>Optional</span>
            </div>
            <p id="fosscord-pride-signup-hint" className="fosscord-pride-signup-hint">
                Show flags on your profile. You can change them later in Profiles settings.
            </p>
            <input
                type="search"
                className="fosscord-pride-signup-search"
                placeholder="Search flags"
                aria-label="Search pride flags"
                autoComplete="off"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                onKeyDown={(event) => {
                    if (event.key === "Enter") event.preventDefault();
                }}
            />
            {visible.length ? (
                <div id="fosscord-pride-signup-grid" className="fosscord-pride-signup-grid" role="group" aria-label="Pride flags">
                    {visible.map((badge) => {
                        const on = selected.includes(badge.slug);
                        return (
                            <button
                                key={badge.slug}
                                type="button"
                                className="fosscord-pride-signup-flag"
                                aria-pressed={on}
                                aria-label={badge.description}
                                aria-disabled={!on && full}
                                title={badge.description}
                                onClick={() => {
                                    if (!on && full) return;
                                    setSelected((current) => (on ? current.filter((slug) => slug !== badge.slug) : [...current, badge.slug]));
                                }}
                                onFocus={() => setPointed(badge)}
                                onBlur={() => setPointed(null)}
                                onMouseEnter={() => setPointed(badge)}
                                onMouseLeave={() => setPointed(null)}
                            >
                                <img src={badge.icon_url} alt="" width="32" height="32" loading="lazy" draggable={false} />
                            </button>
                        );
                    })}
                </div>
            ) : (
                <p className="fosscord-pride-signup-hint">No flags match your search.</p>
            )}
            {collapsible && (
                <button
                    type="button"
                    className="fosscord-pride-signup-more"
                    aria-expanded={expanded}
                    aria-controls="fosscord-pride-signup-grid"
                    onClick={() => setExpanded(!expanded)}
                >
                    {expanded ? "Show fewer flags" : `Show all ${catalog.badges.length} flags`}
                </button>
            )}
            <div className="fosscord-pride-signup-footer">
                <p className="fosscord-pride-signup-caption">
                    {pointed
                        ? `${pointed.description}${selected.includes(pointed.slug) ? ", selected" : ""}`
                        : names.length
                          ? `${names.length} selected: ${names.join(", ")}`
                          : "No flags selected"}
                </p>
                {selected.length > 0 && (
                    <button type="button" className="fosscord-pride-signup-clear" onClick={() => setSelected([])}>
                        Clear
                    </button>
                )}
            </div>
        </section>
    );
}
