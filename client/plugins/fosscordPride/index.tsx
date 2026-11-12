import ErrorBoundary from "@components/ErrorBoundary";
import { ModalCloseButton, ModalContent, ModalHeader, ModalRoot, ModalSize, openModal } from "@utils/modal";
import definePlugin, { StartAt } from "@utils/types";
import { Checkbox, FluxDispatcher, ReactDOM, RestAPI, Text, UserStore, useEffect, useState, useStateFromStores } from "@webpack/common";

import { FosscordAuthor } from "../fosscordCore/shared";
import { SettingsSection, Field, Button } from "../fosscordCore/ui";
import managedStyle from "./style.css?managed";
import { flagsFrom, PrideFlags, prepareUser } from "./flags";
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

function applyOwnFlags(flags: string[]) {
    const user = UserStore.getCurrentUser();
    if (user) FluxDispatcher.dispatch({ type: "CURRENT_USER_UPDATE", user: { ...user, pride_badges: flags } });
}

function PridePicker({ embedded = false }: { embedded?: boolean }) {
    const [navigationHost, setNavigationHost] = useState<HTMLElement | null>(null);
    const [settingsMenu, setSettingsMenu] = useState(false);
    useEffect(() => {
        if (embedded) return;
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
        try {
            const { body } = await RestAPI.patch({
                url: "/users/@me/pride-badges",
                body: { flags: selection },
            });
            setFlags(body.flags);
            setSaved(body.flags);
            applyOwnFlags(body.flags);
            setMessage(selection.length ? "Pride badges saved." : "Pride badges removed.");
        } catch {
            setError("Could not save pride badges. Try again.");
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

function openPrideModal() {
    openModal((props) => (
        <ModalRoot {...props} size={ModalSize.MEDIUM}>
            <ModalHeader>
                <Text variant="heading-lg/semibold" style={{ flexGrow: 1 }}>
                    Pride flags
                </Text>
                <ModalCloseButton onClick={props.onClose} />
            </ModalHeader>
            <ModalContent className="fosscord-pride-modal">
                <PridePicker embedded />
            </ModalContent>
        </ModalRoot>
    ));
}

function PrideSidebarEntry() {
    const userId = useStateFromStores([UserStore], () => UserStore.getCurrentUser()?.id);
    const chosen = useStateFromStores([UserStore], () => flagsFrom(UserStore.getCurrentUser() as never).length);
    return (
        <div className="fosscord-pride-sidebar-entry">
            <Text variant="text-sm/medium">Pride Flags</Text>
            <button type="button" className="fosscord-pride-sidebar-tile" onClick={openPrideModal} aria-label="Choose pride flags">
                {chosen ? <PrideFlags userId={userId} max={6} /> : <span>Choose flags</span>}
            </button>
        </div>
    );
}

export default definePlugin({
    name: "FosscordPride",
    description: "Choose locally hosted pride flags in Profiles settings and on the signup form and show them with the pronouns on profiles.",
    authors: [FosscordAuthor],
    required: true,
    managedStyle,
    startAt: StartAt.DOMContentLoaded,
    renderPicker: () => <PridePicker />,
    renderSidebarEntry: ErrorBoundary.wrap(() => <PrideSidebarEntry key="fosscord-pride-sidebar" />, { noop: true }),
    renderSignupPicker: () => <SignupPridePicker key="fosscord-pride-signup" />,
    takeSignupSelection,
    flagsFrom,
    prepareUser,
    hasFlags: (user: { prideBadges?: unknown } | undefined) => Array.isArray(user?.prideBadges) && user.prideBadges.length > 0,
    pronounsWithFlags: (pronouns: string | undefined, pronounsElement: unknown, user: { id?: string } | undefined) => (
        <span className="fosscord-pride-pronouns">
            {pronouns?.length ? pronounsElement : null}
            <PrideFlags userId={user?.id} max={8} className="fosscord-pride-flags-pronouns" />
        </span>
    ),
    patches: [
        {
            find: "has_bounced_email??",
            replacement: {
                match: /this\.displayNameStyles=\i\.displayNameStyles\?\?/,
                replace: "this.prideBadges=$self.flagsFrom(arguments[0]),$&",
            },
        },
        {
            find: 'displayName="UserStore"',
            replacement: [
                {
                    match: /(function \i\((\i)\)\{)(let \i=\2\.mfa_enabled;)/,
                    replace: "$1$self.prepareUser($2);$3",
                },
                {
                    match: /\["username","avatar","global_name"/,
                    replace: '["pride_badges","username","avatar","global_name"',
                },
            ],
        },
        {
            find: "onClickDisplayName:",
            replacement: [
                {
                    match: /(\i)=(null!=(\i)&&\3\.length>0)(,\i=\(0,\i\.\i\)\((\i)\),)/,
                    replace: "$1=($2||$self.hasFlags($5))$4",
                },
                {
                    match: /\(0,\i\.jsx\)\(\i\.\i,\{text:\i\.intl\.string\(\i\.t\.GI2A8C\),delay:\i\.\i,ariaHidden:!0,children:\(0,\i\.jsx\)\("span",\{className:\i\.\i,children:\(0,\i\.jsx\)\(\i,\{pronouns:(\i)\}\)\}\)\}\)/,
                    replace: "$self.pronounsWithFlags($1,$&,arguments[0]?.user)",
                },
            ],
        },
        {
            find: "currentGlobalName:",
            replacement: {
                match: /(currentPronouns:\i\?\.pronouns\?\?""\},"pronouns"\),)/,
                replace: "$1$self.renderPicker(),",
            },
        },
        {
            find: '"user-profile-editing-panel"',
            replacement: {
                match: /(?=\i&&\(0,\i\.jsxs\)\(\i\.Fragment,\{children:\[\(0,\i\.jsx\)\(\i,\{user:\i\}\),\(0,\i\.jsx\)\(\i,\{\}\)\]\}\))/,
                replace: "null==arguments[0]?.selectedGuildId&&$self.renderSidebarEntry(),",
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
