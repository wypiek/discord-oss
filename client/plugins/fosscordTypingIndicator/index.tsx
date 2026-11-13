import ErrorBoundary from "@components/ErrorBoundary";
import { ModalCloseButton, ModalContent, ModalHeader, ModalRoot, ModalSize, openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { findByPropsLazy, findComponentByCodeLazy } from "@webpack";
import {
    EmojiStore,
    FluxDispatcher,
    IconUtils,
    Popout,
    RelationshipStore,
    RestAPI,
    Text,
    TextInput,
    TypingStore,
    UserStore,
    useRef,
    useState,
    useStateFromStores,
} from "@webpack/common";
import type { ReactNode } from "react";

import { FosscordAuthor } from "../fosscordCore/shared";
import { Button, SettingsSection } from "../fosscordCore/ui";
import managedStyle from "./style.css?managed";

type StyleEmoji = { id?: string; name: string; animated?: boolean };
type TypingStyle = { emojis: StyleEmoji[]; animation: number; typingSuggestion: number; customText?: string | null };
type TypingProps = { channel?: { id: string }; typingUsers?: unknown[] };
type PickedEmoji = { id?: string | null; name?: string | null; animated?: boolean; surrogates?: string; optionallyDiverseSequence?: string };
type EmojiPickerProps = {
    pickerIntention: number;
    closePopout: () => void;
    onNavigateAway?: () => void;
    onSelectEmoji: (selection: { emoji: PickedEmoji | null; willClose: boolean }) => void;
};

const EmojiPicker = findComponentByCodeLazy<EmojiPickerProps>("hasTabWrapper:", "showOnlyUnicode:", "isViewingEmojiPacks:");
const EmojiConstants: { EmojiIntention: Record<string, number> } = findByPropsLazy("EmojiIntention", "isExternalEmojiAllowedForIntention");

export const SUGGESTIONS = ["is typing…", "is yapping…", "is venting…", "is oversharing…", "is barking…", "is babbling…", "is daydreaming…", "is meowing…"];
export const ANIMATIONS = ["None", "Pulse", "Ring", "Wave"];
const SURPRISE_EMOJIS = ["😈", "🤠", "🤪", "🐱", "🐶", "🔥", "✨", "💀", "🫠", "🥺", "😎", "🤖", "👻", "🌈", "🍕", "🎉", "💅", "🦄", "🐸", "🌸"];
const CUSTOM = -1;
const MAX_TEXT = 32;
const MAX_EMOJIS = 3;

const emojiUrl = (emoji: StyleEmoji) => IconUtils.getEmojiURL({ id: emoji.id ?? "", animated: !!emoji.animated, size: 48 });

const styleOf = (userId: string | undefined): TypingStyle | null => {
    if (!userId) return null;
    const style = (UserStore.getUser(userId) as unknown as { typingIndicatorStyle?: TypingStyle | null } | undefined)?.typingIndicatorStyle;
    return style ?? null;
};

const soleTypist = (props: TypingProps) => {
    const channelId = props?.channel?.id;
    if (!channelId) return undefined;
    const me = UserStore.getCurrentUser()?.id;
    const ids = Object.keys((TypingStore.getTypingUsers(channelId) ?? {}) as Record<string, number>).filter((id) => id !== me && !RelationshipStore.isBlocked(id));
    return ids.length === 1 ? ids[0] : undefined;
};

export const typingTextFor = (style: TypingStyle | null) => {
    if (!style) return null;
    const custom = style.customText?.trim();
    if (custom) return custom;
    return style.typingSuggestion > 0 ? (SUGGESTIONS[style.typingSuggestion] ?? null) : null;
};

function Emojis({ style, size = 18 }: { style: TypingStyle; size?: number }) {
    return (
        <span className={`fosscord-typing-emojis fosscord-typing-animation-${style.animation}`} aria-hidden>
            {style.emojis.slice(0, MAX_EMOJIS).map((emoji, index) => (
                <span key={index} className="fosscord-typing-emoji" style={{ animationDelay: `${index * 0.18}s`, fontSize: size, width: size + 2, height: size + 2 }}>
                    <EmojiGlyph emoji={emoji} size={size} />
                </span>
            ))}
        </span>
    );
}

function EmojiGlyph({ emoji, size }: { emoji: StyleEmoji; size: number }) {
    return emoji.id ? <img src={emojiUrl(emoji)} alt="" width={size} height={size} draggable={false} /> : emoji.name;
}

function Dots() {
    return (
        <span className="fosscord-typing-dots" aria-hidden>
            <span />
            <span />
            <span />
        </span>
    );
}

const parseEmoji = (value: string): StyleEmoji | null => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const custom = /^<(a?):([\w~-]{1,32}):(\d{1,20})>$/.exec(trimmed);
    if (custom) return { id: custom[3], name: custom[2], animated: custom[1] === "a" };
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const first = segmenter.segment(trimmed)[Symbol.iterator]().next().value?.segment ?? "";
    return /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u.test(first) ? { name: first } : null;
};

const fromPicker = (emoji: PickedEmoji | null): StyleEmoji | null => {
    if (!emoji) return null;
    if (emoji.id) return { id: emoji.id, name: emoji.name ?? "", animated: !!emoji.animated };
    return parseEmoji(emoji.optionallyDiverseSequence || emoji.surrogates || "");
};

const emojiLabel = (emoji: StyleEmoji) => (emoji.id ? `:${emoji.name || EmojiStore.getCustomEmojiById(emoji.id)?.name || "custom emoji"}:` : emoji.name);

const pickerIntention = () => EmojiConstants.EmojiIntention.TYPING_INDICATOR ?? EmojiConstants.EmojiIntention.STATUS;

function EmojiPickerTile({
    filled,
    label,
    onPick,
    onNavigateAway,
    children,
}: {
    filled: boolean;
    label: string;
    onPick: (emoji: StyleEmoji, first: boolean) => boolean;
    onNavigateAway?: () => void;
    children: ReactNode;
}) {
    const tileRef = useRef<HTMLButtonElement>(null);
    const picks = useRef(0);
    return (
        <Popout
            targetElementRef={tileRef}
            position="bottom"
            align="center"
            renderPopout={({ closePopout }) => (
                <ErrorBoundary noop>
                    <EmojiPicker
                        pickerIntention={pickerIntention()}
                        closePopout={closePopout}
                        onNavigateAway={() => {
                            closePopout();
                            onNavigateAway?.();
                        }}
                        onSelectEmoji={({ emoji, willClose }) => {
                            const chosen = fromPicker(emoji);
                            const roomLeft = chosen ? onPick(chosen, picks.current++ === 0) : true;
                            if (willClose || !roomLeft) closePopout();
                        }}
                    />
                </ErrorBoundary>
            )}
        >
            {(popoutProps, { isShown }) => (
                <button
                    {...popoutProps}
                    onClick={(event) => {
                        if (!isShown) picks.current = 0;
                        popoutProps.onClick(event);
                    }}
                    ref={tileRef}
                    type="button"
                    className={`fosscord-typing-slot${filled ? "" : " fosscord-typing-slot-add"}${isShown ? " fosscord-typing-slot-active" : ""}`}
                    aria-label={label}
                >
                    {children}
                </button>
            )}
        </Popout>
    );
}

const pick = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)];

function TypingIndicatorEditor({ onNavigateAway }: { onNavigateAway?: () => void }) {
    const me = UserStore.getCurrentUser();
    const saved = styleOf(me?.id);
    const [emojis, setEmojisState] = useState<StyleEmoji[]>(() => (saved?.emojis ?? []).slice(0, MAX_EMOJIS));
    const latestEmojis = useRef(emojis);
    const [typed, setTyped] = useState("");
    const [animation, setAnimation] = useState(saved?.animation ?? 0);
    const [suggestion, setSuggestion] = useState(saved?.customText ? CUSTOM : (saved?.typingSuggestion ?? 0));
    const [customText, setCustomText] = useState(saved?.customText ?? "");
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);

    const typedEmoji = parseEmoji(typed);
    const invalid = !!typed.trim() && !typedEmoji;
    const full = emojis.length >= MAX_EMOJIS;
    const draft: TypingStyle = {
        emojis: typedEmoji && !full ? [...emojis, typedEmoji] : emojis,
        animation,
        typingSuggestion: suggestion === CUSTOM ? 0 : suggestion,
        customText: suggestion === CUSTOM ? customText.trim().slice(0, MAX_TEXT) || null : null,
    };
    const name = me?.globalName || me?.username || "You";

    const save = async (style: TypingStyle | null) => {
        setBusy(true);
        setNotice(null);
        try {
            const { body } = await RestAPI.patch({
                url: "/users/@me",
                body: {
                    typing_indicator_style: style && {
                        emojis: style.emojis.map((emoji) => (emoji.id ? { custom_emoji_id: emoji.id } : { unicode_emoji: emoji.name })),
                        animation: style.animation,
                        typing_suggestion: style.typingSuggestion,
                        custom_text: style.customText ?? null,
                    },
                },
            });
            FluxDispatcher.dispatch({ type: "CURRENT_USER_UPDATE", user: body });
            setNotice({ error: false, text: style ? "Typing indicator saved." : "Typing indicator reset." });
        } catch (error) {
            const message = (error as { body?: { message?: string } })?.body?.message;
            setNotice({ error: true, text: message ?? "Couldn't save the typing indicator. Try again." });
        } finally {
            setBusy(false);
        }
    };

    const setEmojis = (next: StyleEmoji[]) => {
        latestEmojis.current = next.slice(0, MAX_EMOJIS);
        setEmojisState(latestEmojis.current);
        return latestEmojis.current.length < MAX_EMOJIS;
    };

    const append = (emoji: StyleEmoji) => (latestEmojis.current.length < MAX_EMOJIS ? setEmojis([...latestEmojis.current, emoji]) : false);

    const replaceAt = (index: number) => (emoji: StyleEmoji, first: boolean) => {
        if (!first) return append(emoji);
        setEmojis(latestEmojis.current.map((existing, i) => (i === index ? emoji : existing)));
        return true;
    };

    const removeAt = (index: number) => setEmojis(latestEmojis.current.filter((_, i) => i !== index));

    const addTyped = () => {
        if (!typedEmoji || full) return;
        append(typedEmoji);
        setTyped("");
    };

    const saveDraft = () => {
        addTyped();
        save(draft);
    };

    const reset = () => {
        setEmojis([]);
        setTyped("");
        setAnimation(0);
        setSuggestion(0);
        setCustomText("");
        save(null);
    };

    const surprise = () => {
        const chosen = new Set<string>();
        while (chosen.size < MAX_EMOJIS) chosen.add(pick(SURPRISE_EMOJIS));
        setEmojis([...chosen].map((name) => ({ name })));
        setAnimation(1 + Math.floor(Math.random() * 3));
        setSuggestion(1 + Math.floor(Math.random() * (SUGGESTIONS.length - 1)));
    };

    const text = typingTextFor(draft) ?? SUGGESTIONS[0];
    return (
        <SettingsSection className="fosscord-typing-editor" title="Typing indicator" description="When you're typing, others see this instead of the default typing indicator.">
            <div className="fosscord-typing-preview" role="group" aria-label="Preview">
                {emojis.length ? <Emojis style={draft} /> : <Dots />}
                <span>
                    <strong>{name}</strong> {text}
                </span>
            </div>

            <Text variant="text-sm/medium">Emojis</Text>
            <div className="fosscord-typing-slots">
                {emojis.map((emoji, index) => (
                    <div key={index} className="fosscord-typing-slot-wrap">
                        <EmojiPickerTile filled label={`Change emoji ${index + 1}, ${emojiLabel(emoji)}`} onPick={replaceAt(index)} onNavigateAway={onNavigateAway}>
                            <EmojiGlyph emoji={emoji} size={32} />
                        </EmojiPickerTile>
                        <button type="button" className="fosscord-typing-slot-remove" aria-label={`Remove emoji ${index + 1}`} onClick={() => removeAt(index)}>
                            <svg viewBox="0 0 24 24" width={12} height={12} aria-hidden>
                                <path
                                    fill="currentColor"
                                    d="M17.3 18.7a1 1 0 0 0 1.4-1.4L13.42 12l5.3-5.3a1 1 0 0 0-1.42-1.4L12 10.58l-5.3-5.3a1 1 0 0 0-1.4 1.42L10.58 12l-5.3 5.3a1 1 0 1 0 1.42 1.4L12 13.42l5.3 5.3Z"
                                />
                            </svg>
                        </button>
                    </div>
                ))}
                {!full && (
                    <EmojiPickerTile filled={false} label="Add emoji" onPick={append} onNavigateAway={onNavigateAway}>
                        <svg viewBox="0 0 24 24" width={20} height={20} aria-hidden>
                            <path fill="currentColor" d="M13 5a1 1 0 1 0-2 0v6H5a1 1 0 1 0 0 2h6v6a1 1 0 1 0 2 0v-6h6a1 1 0 1 0 0-2h-6V5Z" />
                        </svg>
                        <span>Add emoji</span>
                    </EmojiPickerTile>
                )}
            </div>
            <div className="fosscord-typing-typed">
                <TextInput
                    value={typed}
                    disabled={full}
                    placeholder={full ? "Remove an emoji to add another" : "Or paste an emoji, or <:name:id>"}
                    aria-label="Paste an emoji"
                    onChange={(value: string) => setTyped(value)}
                    onKeyDown={(event: { key: string }) => event.key === "Enter" && addTyped()}
                />
                <Button variant="secondary" disabled={full || !typedEmoji} onClick={addTyped}>
                    Add
                </Button>
            </div>
            <Text variant="text-xs/normal" color={invalid ? "text-danger" : "text-muted"}>
                {invalid
                    ? "That isn't an emoji. Paste one emoji, or a custom emoji written as <:name:id>."
                    : `Pick up to ${MAX_EMOJIS} emojis, your servers' emojis included. Shift-click in the picker to add several at once. With no emojis, others see the dots.`}
            </Text>

            <Text variant="text-sm/medium">Animation</Text>
            <Choices options={ANIMATIONS} value={animation} onChange={setAnimation} />

            <Text variant="text-sm/medium">Text</Text>
            <Choices
                options={[...SUGGESTIONS, "Your own text"]}
                value={suggestion === CUSTOM ? SUGGESTIONS.length : suggestion}
                onChange={(index) => setSuggestion(index === SUGGESTIONS.length ? CUSTOM : index)}
            />
            {suggestion === CUSTOM && (
                <TextInput
                    value={customText}
                    maxLength={MAX_TEXT}
                    placeholder="is cooking…"
                    aria-label="Your own typing text"
                    onChange={(value: string) => setCustomText(value.slice(0, MAX_TEXT))}
                />
            )}

            {notice && (
                <Text variant="text-sm/normal" color={notice.error ? "text-danger" : "text-positive"} role="status">
                    {notice.text}
                </Text>
            )}
            <div className="fosscord-typing-actions">
                <Button disabled={busy || invalid} onClick={saveDraft}>
                    Save
                </Button>
                <Button variant="secondary" disabled={busy} onClick={surprise}>
                    Surprise me
                </Button>
                <Button variant="secondary" disabled={busy} onClick={reset}>
                    Reset
                </Button>
            </div>
        </SettingsSection>
    );
}

function openEditor() {
    openModal((props) => (
        <ModalRoot {...props} size={ModalSize.MEDIUM}>
            <ModalHeader>
                <Text variant="heading-lg/semibold" style={{ flexGrow: 1 }}>
                    Typing indicator
                </Text>
                <ModalCloseButton onClick={props.onClose} />
            </ModalHeader>
            <ModalContent className="fosscord-typing-modal">
                <TypingIndicatorEditor onNavigateAway={props.onClose} />
            </ModalContent>
        </ModalRoot>
    ));
}

function SidebarEntry() {
    const style = useStateFromStores([UserStore], () => styleOf(UserStore.getCurrentUser()?.id));
    return (
        <div className="fosscord-profile-sidebar-entry">
            <Text variant="text-sm/medium">Typing Indicator</Text>
            <button type="button" className="fosscord-profile-sidebar-tile" onClick={openEditor} aria-label="Edit typing indicator">
                {style?.emojis?.length ? <Emojis style={style} size={18} /> : <Dots />}
                <span className="fosscord-typing-sidebar-text">{typingTextFor(style) ?? SUGGESTIONS[0]}</span>
            </button>
        </div>
    );
}

function Choices({ options, value, onChange }: { options: string[]; value: number; onChange: (index: number) => void }) {
    return (
        <div className="fosscord-typing-choices" role="radiogroup">
            {options.map((option, index) => (
                <button key={option} type="button" role="radio" aria-checked={value === index} className="fosscord-typing-choice" onClick={() => onChange(index)}>
                    {option}
                </button>
            ))}
        </div>
    );
}

const SafeEditor = ErrorBoundary.wrap(TypingIndicatorEditor, { noop: true });
const SafeSidebarEntry = ErrorBoundary.wrap(SidebarEntry, { noop: true });

export default definePlugin({
    name: "FosscordTypingIndicator",
    description: "Custom typing indicators: up to three emojis with an animation instead of the dots, and a preset or your own text, edited in Profiles settings.",
    authors: [FosscordAuthor],
    required: true,
    managedStyle,
    renderEditor: () => <SafeEditor key="fosscord-typing-indicator" />,
    renderSidebarEntry: () => <SafeSidebarEntry key="fosscord-typing-sidebar" />,
    typingText(props: TypingProps, name: string, original: ReactNode) {
        const text = typingTextFor(styleOf(soleTypist(props)));
        if (!text) return original;
        return (
            <>
                <strong>{name}</strong> {text}
            </>
        );
    },
    typingDots(props: TypingProps, original: ReactNode) {
        const style = styleOf(soleTypist(props));
        return style?.emojis?.length ? <Emojis style={style} size={16} /> : original;
    },
    patches: [
        {
            find: ".typing_suggestion??",
            replacement: [
                {
                    match: /typing_suggestion:(\i)\.typingSuggestion/,
                    replace: "$&,custom_text:$1.customText??null",
                },
                {
                    match: /typingSuggestion:(\i)\.typing_suggestion\?\?/,
                    replace: "customText:$1.custom_text??null,$&",
                },
            ],
        },
        {
            find: 'displayName="UserStore"',
            replacement: {
                match: /"global_name","discriminator"/,
                replace: '"global_name","typing_indicator_style","discriminator"',
            },
        },
        {
            find: "activityInviteEducationActivity:",
            replacement: [
                {
                    match: /(\i)=(\i\.intl\.format\(\i\.t\.lJ9sZX,\{a:(\i)\}\))/,
                    replace: "$1=$self.typingText(arguments[0],$3,$2)",
                },
                {
                    match: /(\i\.length>0&&!1!==\i&&)(\(\i\?\(0,\i\.jsx\)\(\i,\{\}\):\(0,\i\.jsx\)\(\i\.\i,\{className:\i\.\i,dotRadius:3\.5,themed:!0\}\)\))/,
                    replace: "$1$self.typingDots(arguments[0],$2)",
                },
            ],
        },
        {
            find: "currentGlobalName:",
            replacement: {
                match: /(currentPronouns:\i\?\.pronouns\?\?""\},"pronouns"\),)/,
                replace: "$1$self.renderEditor(),",
            },
        },
        {
            find: '"user-profile-editing-panel"',
            replacement: {
                match: /(?=\i&&\(0,\i\.jsxs\)\(\i\.Fragment,\{children:\[\(0,\i\.jsx\)\(\i,\{user:\i\}\),\(0,\i\.jsx\)\(\i,\{\}\)\]\}\))/,
                replace: "null==arguments[0]?.selectedGuildId&&$self.renderSidebarEntry(),",
            },
        },
    ],
});
