import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import ErrorBoundary from "@components/ErrorBoundary";
import {
    ModalCloseButton as CloseButtonComponent,
    ModalContent as ContentComponent,
    ModalFooter as FooterComponent,
    ModalHeader as HeaderComponent,
    ModalRoot as RootComponent,
    ModalSize,
    openModal,
} from "@utils/modal";
import definePlugin from "@utils/types";
import {
    Button,
    GuildMemberStore,
    GuildRoleStore,
    GuildStore,
    Menu,
    PermissionsBits,
    PermissionStore,
    RestAPI,
    showToast,
    Text,
    Tooltip,
    UserStore,
    useEffect,
    useReducer,
    useState,
} from "@webpack/common";
import type { ComponentType, ReactNode } from "react";

import { FosscordAuthor } from "../fosscordCore/shared";
import managedStyle from "./style.css?managed";

type Expirations = Record<string, string>;
type Role = { id: string; name: string; managed?: boolean; colorString?: string | null };
type Guild = { id: string; ownerId?: string };
type ModalProps = { onClose: () => void; transitionState: unknown };
type Loose = ComponentType<Record<string, unknown>>;
const ModalRoot = RootComponent as unknown as Loose;
const ModalHeader = HeaderComponent as unknown as Loose;
const ModalContent = ContentComponent as unknown as Loose;
const ModalFooter = FooterComponent as unknown as Loose;
const ModalCloseButton = CloseButtonComponent as unknown as Loose;

const DAY = 86_400;
const PRESETS = [
    { label: "1 day", seconds: DAY },
    { label: "7 days", seconds: 7 * DAY },
    { label: "30 days", seconds: 30 * DAY },
];
const MIN_MS = 60_000;
const MAX_MS = 365 * DAY * 1000;
const STALE_MS = 5 * 60_000;

const cache = new Map<string, { expirations: Expirations; fetchedAt: number }>();
const inflight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
const keyOf = (guildId: string, userId: string) => `${guildId}:${userId}`;
const notify = () => {
    for (const listener of listeners) listener();
};

function store(guildId: string, userId: string, expirations: Expirations | undefined) {
    if (expirations === undefined) cache.delete(keyOf(guildId, userId));
    else cache.set(keyOf(guildId, userId), { expirations, fetchedAt: Date.now() });
    notify();
}

function refresh(guildId: string, userId: string) {
    const key = keyOf(guildId, userId);
    const running = inflight.get(key);
    if (running) return running;
    const request = RestAPI.get({ url: `/guilds/${guildId}/members/${userId}` })
        .then((response: { body?: { role_expirations?: Expirations } }) => store(guildId, userId, response.body?.role_expirations ?? {}))
        .catch(() => store(guildId, userId, {}))
        .finally(() => inflight.delete(key));
    inflight.set(key, request);
    return request;
}

function useExpirations(guildId: string | undefined, userId: string | undefined) {
    const [, rerender] = useReducer((count: number) => count + 1, 0);
    useEffect(() => {
        listeners.add(rerender);
        return () => void listeners.delete(rerender);
    }, []);
    const entry = guildId && userId ? cache.get(keyOf(guildId, userId)) : undefined;
    useEffect(() => {
        if (guildId && userId && (!entry || Date.now() - entry.fetchedAt > STALE_MS)) void refresh(guildId, userId);
    }, [guildId, userId, entry]);
    return entry?.expirations;
}

function canManageRole(guild: Guild | undefined, role: Role | undefined) {
    if (!guild || !role || role.managed || role.id === guild.id) return false;
    if (!PermissionStore.can(PermissionsBits.MANAGE_ROLES, guild as never)) return false;
    if (guild.ownerId && guild.ownerId === UserStore.getCurrentUser()?.id) return true;
    return PermissionStore.isRoleHigher(guild as never, PermissionStore.getHighestRole(guild as never), role as never);
}

function relativeTime(target: number) {
    const remaining = target - Date.now();
    if (remaining <= 0) return "now";
    const minutes = Math.round(remaining / 60_000);
    if (minutes < 60) return `in ${Math.max(1, minutes)} minute${minutes === 1 ? "" : "s"}`;
    if (remaining < 23.5 * 3_600_000) {
        const hours = Math.max(1, Math.round(remaining / 3_600_000));
        return `in ${hours} hour${hours === 1 ? "" : "s"}`;
    }
    const days = Math.max(1, Math.round(remaining / 86_400_000));
    return `in ${days} day${days === 1 ? "" : "s"}`;
}

const formatDate = (target: number) => new Date(target).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function describeExpiry(expiresAt: string) {
    const target = new Date(expiresAt).getTime();
    return target <= Date.now() ? `Expires now, on ${formatDate(target)}` : `Expires ${relativeTime(target)}, on ${formatDate(target)}`;
}

function localInputValue(date: Date) {
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function announce(message: string) {
    try {
        showToast(message, "success");
    } catch {}
}

function errorMessage(error: unknown) {
    console.error("[FosscordTemporaryRoles]", error);
    const body = (error as { body?: { message?: string; errors?: Record<string, { _errors?: { message: string }[] }> } })?.body;
    const field = body?.errors && Object.values(body.errors).find((entry) => entry?._errors?.length);
    return field?._errors?.[0]?.message ?? body?.message ?? "Something went wrong. Try again.";
}

function ClockIcon({ size = 12 }: { size?: number }) {
    return (
        <svg className="fosscord-temp-roles-clock" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm-1 3v5.41l3.8 3.8 1.4-1.42L13 11.59V7h-2Z" />
        </svg>
    );
}

type Choice = { kind: "preset"; seconds: number } | { kind: "custom" };

function AssignModal({ modalProps, guildId, userId, role, current }: { modalProps: ModalProps; guildId: string; userId: string; role: Role; current?: string }) {
    const [choice, setChoice] = useState<Choice>(current ? { kind: "custom" } : { kind: "preset", seconds: DAY });
    const [custom, setCustom] = useState(() => localInputValue(current ? new Date(current) : new Date(Date.now() + DAY * 1000)));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const editing = !!current;
    const customDate = new Date(custom);
    const customDelay = customDate.getTime() - Date.now();
    const customInvalid = choice.kind === "custom" && (Number.isNaN(customDelay) || customDelay < MIN_MS || customDelay > MAX_MS);
    const user = UserStore.getUser(userId) as { username?: string; globalName?: string } | undefined;

    async function submit() {
        setBusy(true);
        setError(null);
        try {
            const body = choice.kind === "preset" ? { duration_seconds: choice.seconds } : { expires_at: customDate.toISOString() };
            await RestAPI.put({ url: `/guilds/${guildId}/members/${userId}/roles/${role.id}`, body });
            await refresh(guildId, userId);
            announce(editing ? `Updated when ${role.name} expires.` : `Assigned ${role.name} temporarily.`);
            modalProps.onClose();
        } catch (failure) {
            setError(errorMessage(failure));
        } finally {
            setBusy(false);
        }
    }

    async function makePermanent() {
        setBusy(true);
        setError(null);
        try {
            await RestAPI.patch({ url: `/guilds/${guildId}/members/${userId}`, body: { role_expirations: { [role.id]: null } } });
            await refresh(guildId, userId);
            announce(`${role.name} no longer expires.`);
            modalProps.onClose();
        } catch (failure) {
            setError(errorMessage(failure));
        } finally {
            setBusy(false);
        }
    }

    const chips: { label: string; choice: Choice }[] = [
        ...PRESETS.map((preset) => ({ label: preset.label, choice: { kind: "preset", seconds: preset.seconds } as Choice })),
        { label: "Custom", choice: { kind: "custom" } },
    ];
    const selected = (option: Choice) => option.kind === choice.kind && (option.kind === "custom" || (choice.kind === "preset" && option.seconds === choice.seconds));

    return (
        <ModalRoot {...modalProps} size={ModalSize.SMALL} className="fosscord-temp-roles-modal">
            <ModalHeader separator={false}>
                <Text variant="heading-lg/semibold" style={{ flexGrow: 1 }}>
                    {editing ? "Change role expiry" : "Assign role"}
                </Text>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>
            <ModalContent className="fosscord-temp-roles-body">
                <div className="fosscord-temp-roles-role">
                    <span className="fosscord-temp-roles-dot" style={{ background: role.colorString ?? "var(--text-muted)" }} aria-hidden="true" />
                    <Text variant="text-md/semibold" color="text-strong">
                        {role.name}
                    </Text>
                    {user && (
                        <Text variant="text-sm/normal" color="text-muted">
                            for {user.globalName ?? user.username}
                        </Text>
                    )}
                </div>
                {current && (
                    <Text variant="text-sm/normal" color="text-muted">
                        {describeExpiry(current)}
                    </Text>
                )}
                <Text variant="text-xs/semibold" color="text-muted" className="fosscord-temp-roles-label">
                    Expires
                </Text>
                <div className="fosscord-temp-roles-chips" role="radiogroup" aria-label="Expires">
                    {chips.map((chip) => (
                        <button
                            key={chip.label}
                            type="button"
                            role="radio"
                            aria-checked={selected(chip.choice)}
                            className="fosscord-temp-roles-chip"
                            onClick={() => setChoice(chip.choice)}
                        >
                            {chip.label}
                        </button>
                    ))}
                </div>
                {choice.kind === "custom" && (
                    <label className="fosscord-temp-roles-custom">
                        <Text variant="text-sm/medium">Remove the role on</Text>
                        <input
                            type="datetime-local"
                            className="fosscord-temp-roles-input"
                            value={custom}
                            min={localInputValue(new Date(Date.now() + MIN_MS))}
                            max={localInputValue(new Date(Date.now() + MAX_MS))}
                            aria-invalid={customInvalid}
                            onChange={(event) => setCustom(event.currentTarget.value)}
                        />
                        {customInvalid && (
                            <Text variant="text-xs/normal" color="text-danger">
                                Pick a time between 1 minute and 365 days from now.
                            </Text>
                        )}
                    </label>
                )}
                <div className="fosscord-temp-roles-row">
                    <Text variant="text-sm/medium" color="text-strong">
                        Automatically remove role
                    </Text>
                    <Text variant="text-sm/semibold" color="text-positive">
                        Enabled
                    </Text>
                </div>
                {error && (
                    <Text variant="text-sm/normal" color="text-danger" role="alert">
                        {error}
                    </Text>
                )}
            </ModalContent>
            <ModalFooter className="fosscord-temp-roles-footer">
                <Button color={Button.Colors.BRAND} disabled={busy || customInvalid} onClick={submit}>
                    {editing ? "Save" : "Assign role"}
                </Button>
                {editing && (
                    <Button color={Button.Colors.PRIMARY} look={Button.Looks.LINK} disabled={busy} onClick={makePermanent}>
                        Keep the role permanently
                    </Button>
                )}
            </ModalFooter>
        </ModalRoot>
    );
}

export function openAssignModal(guildId: string, userId: string, roleId: string) {
    const role = GuildRoleStore.getRole(guildId, roleId) as Role | undefined;
    if (!role) return;
    const current = cache.get(keyOf(guildId, userId))?.expirations[roleId];
    openModal((modalProps: ModalProps) => (
        <ErrorBoundary>
            <AssignModal modalProps={modalProps} guildId={guildId} userId={userId} role={role} current={current} />
        </ErrorBoundary>
    ));
}

function ExpiryBadge({ guildId, userId, role }: { guildId: string; userId: string; role: Role }) {
    const expirations = useExpirations(guildId, userId);
    const expiresAt = expirations?.[role.id];
    if (!expiresAt) return null;
    const guild = GuildStore.getGuild(guildId) as Guild | undefined;
    const manageable = canManageRole(guild, role);
    const label = describeExpiry(expiresAt);
    return (
        <Tooltip text={manageable ? `${label}. Click to change.` : label}>
            {(tooltipProps) =>
                manageable ? (
                    <button
                        {...tooltipProps}
                        type="button"
                        className="fosscord-temp-roles-badge"
                        aria-label={`${role.name}: ${label}. Change expiry`}
                        onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            openAssignModal(guildId, userId, role.id);
                        }}
                    >
                        <ClockIcon />
                    </button>
                ) : (
                    <span {...tooltipProps} className="fosscord-temp-roles-badge" role="img" aria-label={`${role.name}: ${label}`}>
                        <ClockIcon />
                    </span>
                )
            }
        </Tooltip>
    );
}

type PillProps = { role?: Role; guildId?: string; fosscordRoleUserId?: string };
const PillExpiry = ErrorBoundary.wrap(ExpiryBadge, { noop: true });

type PickerProps = {
    Picker: ComponentType<Record<string, unknown>>;
    guild: Guild;
    roleStyle: unknown;
    roleFilter: (role: Role) => boolean;
    onSelect: (roleId: string) => void;
    onClose: () => void;
    userId?: string;
};

function RolePicker({ Picker, guild, roleStyle, roleFilter, onSelect, onClose, userId }: PickerProps) {
    const [temporary, setTemporary] = useState(false);
    const select = (roleId: string) => {
        if (!temporary || !userId) return onSelect(roleId);
        onClose();
        openAssignModal(guild.id, userId, roleId);
    };
    return (
        <div className="fosscord-temp-roles-picker" data-temporary={temporary || undefined}>
            <Picker guild={guild} roleStyle={roleStyle} roleFilter={roleFilter} onSelect={select} onClose={onClose} />
            {userId && (
                <button type="button" className="fosscord-temp-roles-picker-toggle" aria-pressed={temporary} onClick={() => setTemporary(!temporary)}>
                    <ClockIcon size={16} />
                    <span>{temporary ? "Pick a role to assign temporarily" : "Assign temporarily…"}</span>
                </button>
            )}
        </div>
    );
}

const userContextPatch: NavContextMenuPatchCallback = (children, props: { user?: { id: string }; guildId?: string }) => {
    const userId = props?.user?.id;
    const guildId = props?.guildId;
    if (!userId || !guildId || !GuildMemberStore.isMember(guildId, userId)) return;
    const guild = GuildStore.getGuild(guildId) as Guild | undefined;
    const roles = (GuildRoleStore.getSortedRoles(guildId) as Role[]).filter((role) => canManageRole(guild, role));
    if (!roles.length) return;
    void refresh(guildId, userId);
    const expirations = cache.get(keyOf(guildId, userId))?.expirations ?? {};
    const entry = (
        <Menu.MenuItem id="fosscord-temporary-roles" key="fosscord-temporary-roles" label="Assign temporarily…">
            {roles.map((role) => (
                <Menu.MenuItem
                    id={`fosscord-temporary-role-${role.id}`}
                    key={role.id}
                    label={role.name}
                    subtext={expirations[role.id] ? describeExpiry(expirations[role.id]) : undefined}
                    action={() => openAssignModal(guildId, userId, role.id)}
                />
            ))}
        </Menu.MenuItem>
    );
    const group = findGroupChildrenByChildId("roles", children);
    const rolesMenu = group?.find((child) => (child as { props?: { id?: string } } | null)?.props?.id === "roles") as { props: { children: ReactNode[] } } | undefined;
    if (rolesMenu && Array.isArray(rolesMenu.props.children)) {
        rolesMenu.props.children.push(<Menu.MenuSeparator key="fosscord-temporary-roles-separator" />, entry);
        return;
    }
    if (group) group.push(entry);
    else children.splice(-1, 0, <Menu.MenuGroup key="fosscord-temporary-roles-group">{entry}</Menu.MenuGroup>);
};

export default definePlugin({
    name: "FosscordTemporaryRoles",
    description: "Assigns roles for a set time from the member context menu and profile, and shows when each temporary role expires.",
    authors: [FosscordAuthor],
    required: true,
    managedStyle,

    withExpiry(props: PillProps, trailing: ReactNode) {
        if (!props.role || !props.guildId || !props.fosscordRoleUserId) return trailing;
        return (
            <>
                <PillExpiry guildId={props.guildId} userId={props.fosscordRoleUserId} role={props.role} />
                {trailing}
            </>
        );
    },

    renderRolePicker(props: PickerProps) {
        return <RolePicker {...props} />;
    },

    contextMenus: {
        "user-context": userContextPatch,
    },

    flux: {
        GUILD_MEMBER_UPDATE({ guildId, user, roleExpirations }: { guildId: string; user?: { id: string }; roleExpirations?: Expirations }) {
            if (!guildId || !user?.id) return;
            const key = keyOf(guildId, user.id);
            if (roleExpirations) store(guildId, user.id, roleExpirations);
            else if (cache.has(key)) store(guildId, user.id, undefined);
        },
        GUILD_MEMBER_REMOVE({ guildId, user }: { guildId: string; user?: { id: string } }) {
            if (guildId && user?.id && cache.has(keyOf(guildId, user.id))) store(guildId, user.id, undefined);
        },
    },

    patches: [
        {
            find: '"GUILD_MEMBER_UPDATE","GUILD_MEMBER_REMOVE"]',
            replacement: {
                match: /("GUILD_MEMBER_UPDATE","GUILD_MEMBER_REMOVE"\],\((\i),\i\)=>\{\i\(\{type:\i,guildId:\2\.guild_id,[^}]*?roles:\2\.roles,)/,
                replace: "$1roleExpirations:$2.role_expirations,",
            },
        },
        {
            find: "canRemoveAnyRoles:",
            replacement: [
                {
                    match: /let\{userId:(\i),guild:(\i),roles:(\i),className:/g,
                    replace: "let{userId:$1,userId:fosscordRoleUserId,guild:$2,roles:$3,className:",
                },
                {
                    match: /role:(\i),guildId:(\i)\.id(?=[,}])/g,
                    replace: "role:$1,guildId:$2.id,fosscordRoleUserId",
                },
                {
                    match: /(function \i\((\i)\)\{let\{role:\i,guildId:\i,)trailing:(\i),([^}]*\}=\2,)/,
                    replace: "$1trailing:fosscordTrailing,$4$3=$self.withExpiry($2,fosscordTrailing),",
                },
                {
                    match: /let\{userId:(\i),guild:(\i),showLabel:/,
                    replace: "let{userId:$1,userId:fosscordRoleUserId,guild:$2,showLabel:",
                },
                {
                    match: /renderPopout:(\i)=>\{let\{closePopout:(\i)\}=\1;return\(0,\i\.jsx\)\((\i(?:\.\i)?),\{guild:(\i),roleStyle:(\i),roleFilter:(\i),onSelect:(\i),onClose:\2\}\)\}/,
                    replace:
                        "renderPopout:$1=>{let{closePopout:$2}=$1;return $self.renderRolePicker({Picker:$3,guild:$4,roleStyle:$5,roleFilter:$6,onSelect:$7,onClose:$2,userId:fosscordRoleUserId})}",
                },
            ],
        },
    ],
});
