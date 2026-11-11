import definePlugin, { StartAt } from "@utils/types";
import { Checkbox, FluxDispatcher, ReactDOM, RestAPI, Text, UserProfileStore, UserStore, useEffect, useState } from "@webpack/common";

import { FosscordAuthor } from "../fosscordCore/shared";
import { SettingsSection, Field, Button } from "../fosscordCore/ui";
import managedStyle from "./style.css?managed";
import { matches, SignupPridePicker, takeSignupSelection } from "./signup";

type Badge = {
    slug: string;
    id: string;
    description: string;
    icon: string;
    source?: "twemoji-flags" | "supplemental";
    aliases?: string[];
};

type Selection = { flags: string[]; catalog: Badge[] };
const pending = new Map<string, { signature?: string; dirty: boolean; promise: Promise<void> }>();

function refreshProfile(id: string, signature?: string): Promise<void> {
    const running = pending.get(id);
    if (running) {
        if (signature === undefined || signature !== running.signature) {
            running.signature = signature ?? running.signature;
            running.dirty = true;
        }
        return running.promise;
    }
    if (pending.size >= 32) return Promise.reject(new Error("Profile refresh capacity reached."));
    const state = { signature, dirty: false, promise: Promise.resolve() };
    pending.set(id, state);
    state.promise = (async () => {
        try {
            do {
                state.dirty = false;
                try {
                    const { body } = await RestAPI.get({ url: `/users/${id}/profile` });
                    FluxDispatcher.dispatch({ type: "USER_PROFILE_FETCH_SUCCESS", userProfile: body });
                } catch (error) {
                    if (!state.dirty) throw error;
                }
            } while (state.dirty);
        } finally {
            pending.delete(id);
        }
    })();
    return state.promise;
}

function profileChanged(event: { user?: { id: string; pride_badges?: string[] }; updates?: { user?: { id: string; pride_badges?: string[] } }[] }) {
    for (const user of [event.user, ...(event.updates ?? []).map((update) => update.user)]) {
        if (user?.pride_badges !== undefined && UserProfileStore.getUserProfile(user.id)) refreshProfile(user.id, JSON.stringify(user.pride_badges)).catch(() => {});
    }
}

function PridePicker() {
    const [navigationHost, setNavigationHost] = useState<HTMLElement | null>(null);
    const [settingsMenu, setSettingsMenu] = useState(false);
    useEffect(() => {
        let shell: HTMLElement | null = document.querySelector(".fosscord-pride");
        while (shell && !shell.querySelector(":scope > aside")) shell = shell.parentElement;
        const sidebar = shell?.querySelector<HTMLElement>(":scope > aside");
        const header = shell?.querySelector<HTMLElement>('[class*="contentHeader_"]');
        if (!shell || !sidebar || !header) return;
        shell.classList.add("fosscord-pride-shell");
        const host = document.createElement("div");
        host.className = "fosscord-pride-mobile-nav";
        header.prepend(host);
        setNavigationHost(host);
        const navigate = (event: Event) => {
            if ((event.target as HTMLElement).closest('[data-settings-sidebar-item] [role="link"]')) setSettingsMenu(false);
        };
        sidebar.addEventListener("click", navigate);
        return () => {
            sidebar.removeEventListener("click", navigate);
            shell.classList.remove("fosscord-pride-shell");
            delete shell.dataset.fosscordSettingsMenu;
            host.remove();
        };
    }, []);
    useEffect(() => {
        const shell = document.querySelector<HTMLElement>(".fosscord-pride-shell");
        if (shell) shell.dataset.fosscordSettingsMenu = String(settingsMenu);
    }, [settingsMenu, navigationHost]);
    const [catalog, setCatalog] = useState<Badge[]>([]);
    const [flags, setFlags] = useState<string[]>([]);
    const [saved, setSaved] = useState<string[]>([]);
    const [query, setQuery] = useState("");
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    useEffect(() => {
        let active = true;
        RestAPI.get({ url: "/users/@me/pride-badges" })
            .then(({ body }: { body: Selection }) => {
                if (active) {
                    setCatalog(body.catalog);
                    setFlags(body.flags);
                    setSaved(body.flags);
                }
            })
            .catch(() => {
                if (active) setError("Could not load pride badges. Reopen Profiles to try again.");
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, []);
    const save = async (selection: string[]) => {
        setBusy(true);
        setError("");
        setMessage("");
        let persisted = false;
        try {
            const { body } = await RestAPI.patch({
                url: "/users/@me/pride-badges",
                body: { flags: selection },
            });
            setFlags(body.flags);
            setSaved(body.flags);
            persisted = true;
            await refreshProfile(UserStore.getCurrentUser().id);
            setMessage(selection.length ? "Pride badges saved." : "Pride badges removed.");
        } catch {
            setError(persisted ? "Pride badges saved, but the preview could not refresh. Reopen your profile." : "Could not save pride badges. Try again.");
        } finally {
            setBusy(false);
        }
    };
    return (
        <SettingsSection className="fosscord-pride" title="Pride badges" description="Choose flags to show on your profile. Everyone who can view your profile can see them.">
            {navigationHost &&
                ReactDOM.createPortal(
                    <Button variant="secondary" onClick={() => setSettingsMenu(!settingsMenu)}>
                        {settingsMenu ? "Return to profile" : "Back to settings"}
                    </Button>,
                    navigationHost,
                )}
            {loading ? (
                <p role="status">Loading flags…</p>
            ) : (
                <>
                    <Field
                        id="fosscord-pride-search"
                        label="Search flags"
                        type="search"
                        value={query}
                        onChange={setQuery}
                        placeholder="Find a flag"
                        className="fosscord-pride-search"
                    />
                    <div className="fosscord-pride-grid">
                        {catalog
                            .filter((badge) => matches(badge, query))
                            .map((badge) => (
                                <div key={badge.slug} className="fosscord-pride-option" data-selected={flags.includes(badge.slug)}>
                                    <Checkbox
                                        value={flags.includes(badge.slug)}
                                        disabled={busy}
                                        size={20}
                                        onChange={(_, checked) => {
                                            setMessage("");
                                            setFlags((current) => (checked ? [...current, badge.slug] : current.filter((slug) => slug !== badge.slug)));
                                        }}
                                    >
                                        <img
                                            src={`${location.protocol}//${(window as any).GLOBAL_ENV?.CDN_HOST || location.host}/badge-icons/${badge.icon}.png`}
                                            width="30"
                                            height="30"
                                            alt=""
                                        />
                                        <Text variant="text-sm/medium">{badge.description}</Text>
                                    </Checkbox>
                                </div>
                            ))}
                    </div>
                    {!catalog.some((badge) => matches(badge, query)) && <p>No flags match your search.</p>}
                    <div className="fosscord-pride-actions">
                        <Button disabled={busy} onClick={() => save(flags)}>
                            {busy ? "Saving…" : "Save pride badges"}
                        </Button>
                        <Button variant="secondary" disabled={busy || (!flags.length && !saved.length)} onClick={() => save([])}>
                            Remove all
                        </Button>
                        <Text variant="text-sm/normal" color="text-muted" className="fosscord-pride-count">
                            {flags.length} selected
                        </Text>
                    </div>
                </>
            )}
            {!loading && (
                <Text variant="text-xs/normal" color="text-muted" className="fosscord-pride-credit">
                    {catalog.filter((badge) => badge.source === "twemoji-flags").length} Twemoji flags and {catalog.filter((badge) => badge.source === "supplemental").length}{" "}
                    additional flags. Artwork by{" "}
                    <a href="https://github.com/b3yc0d3/twemoji-flags" target="_blank" rel="noreferrer">
                        b3yc0d3 and contributors
                    </a>{" "}
                    (
                    <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">
                        CC BY 4.0
                    </a>
                    ).
                </Text>
            )}
            {error && <p role="alert">{error}</p>}
            {message && <p role="status">{message}</p>}
        </SettingsSection>
    );
}

export default definePlugin({
    name: "FosscordPride",
    description: "Choose locally hosted pride flag badges in Profiles settings and on the signup form.",
    authors: [FosscordAuthor],
    required: true,
    managedStyle,
    startAt: StartAt.DOMContentLoaded,
    renderPicker: () => <PridePicker />,
    renderSignupPicker: () => <SignupPridePicker key="fosscord-pride-signup" />,
    takeSignupSelection,
    flux: {
        USER_UPDATE: profileChanged,
        GUILD_MEMBER_UPDATE: profileChanged,
        PRESENCE_UPDATES: profileChanged,
    },
    patches: [
        {
            find: "currentGlobalName:",
            replacement: {
                match: /(currentPronouns:\i\?\.pronouns\?\?""\},"pronouns"\),)/,
                replace: "$1$self.renderPicker(),",
            },
        },
        {
            find: "REGISTER_PROMO_EMAIL_CHECKBOX_WEB",
            replacement: [
                {
                    match: /\(0,\i\.jsx\)\(\i,\{consent:\i,consentRequired:\i,onConsentChange:\i\}\)/g,
                    replace: "$self.renderSignupPicker(),$&",
                },
                {
                    match: /url:\i\.\i\.REGISTER,body:\{/,
                    replace: "$&pride_badges:$self.takeSignupSelection(),",
                },
            ],
        },
    ],
});
