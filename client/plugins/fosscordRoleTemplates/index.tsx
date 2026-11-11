import definePlugin from "@utils/types";
import { FluxDispatcher, PermissionsBits, PermissionStore, Text, showToast } from "@webpack/common";

import { FosscordAuthor } from "../fosscordCore/shared";
import managedStyle from "./style.css?managed";

// Each template builds on the one before it. None of them includes Administrator, which skips every permission check.
const MEMBER = [
    "VIEW_CHANNEL",
    "CREATE_INSTANT_INVITE",
    "CHANGE_NICKNAME",
    "SEND_MESSAGES",
    "SEND_MESSAGES_IN_THREADS",
    "CREATE_PUBLIC_THREADS",
    "CREATE_PRIVATE_THREADS",
    "EMBED_LINKS",
    "ATTACH_FILES",
    "ADD_REACTIONS",
    "USE_EXTERNAL_EMOJIS",
    "USE_EXTERNAL_STICKERS",
    "READ_MESSAGE_HISTORY",
    "USE_APPLICATION_COMMANDS",
    "USE_EXTERNAL_APPS",
    "SEND_VOICE_MESSAGES",
    "SEND_POLLS",
    "CONNECT",
    "SPEAK",
    "STREAM",
    "USE_VAD",
    "USE_EMBEDDED_ACTIVITIES",
    "USE_SOUNDBOARD",
    "USE_EXTERNAL_SOUNDS",
    "REQUEST_TO_SPEAK",
];
const MODERATOR = [
    ...MEMBER,
    "MANAGE_MESSAGES",
    "MANAGE_THREADS",
    "MODERATE_MEMBERS",
    "KICK_MEMBERS",
    "MANAGE_NICKNAMES",
    "VIEW_AUDIT_LOG",
    "MUTE_MEMBERS",
    "DEAFEN_MEMBERS",
    "MOVE_MEMBERS",
    "BYPASS_SLOWMODE",
    "SET_VOICE_CHANNEL_STATUS",
];
const STAFF = [
    ...MODERATOR,
    "BAN_MEMBERS",
    "MENTION_EVERYONE",
    "PRIORITY_SPEAKER",
    "SEND_TTS_MESSAGES",
    "CREATE_EVENTS",
    "MANAGE_EVENTS",
    "CREATE_GUILD_EXPRESSIONS",
    "MANAGE_GUILD_EXPRESSIONS",
    "VIEW_GUILD_ANALYTICS",
];
const MANAGER = [...STAFF, "MANAGE_CHANNELS", "MANAGE_ROLES", "MANAGE_WEBHOOKS", "MANAGE_GUILD"];

const TEMPLATES = [
    { name: "Member", description: "Chat, react, share files and join voice.", permissions: MEMBER },
    {
        name: "Moderator",
        description: "Member, plus deleting messages, timeouts, kicks and voice moderation.",
        permissions: MODERATOR,
    },
    {
        name: "Staff",
        description: "Moderator, plus bans, @everyone, events and expressions.",
        permissions: STAFF,
    },
    {
        name: "Manager",
        description: "Staff, plus managing channels, roles, webhooks and the server.",
        permissions: MANAGER,
    },
];

type Role = { id: string; permissions: bigint };
type Guild = { id: string };

const bitsOf = (names: string[]) =>
    names.reduce((bits, name) => {
        const bit = (PermissionsBits as unknown as Record<string, bigint | undefined>)[name];
        return bit == null ? bits : bits | bit;
    }, 0n);

const eachBit = (bits: bigint) => {
    const out: bigint[] = [];
    for (let bit = 1n; bit <= bits; bit <<= 1n) if (bits & bit) out.push(bit);
    return out;
};

function apply(template: (typeof TEMPLATES)[number], role: Role, guild: Guild) {
    const wanted = bitsOf(template.permissions);
    // Same rule as the toggles below: you can only hand out permissions you have yourself.
    const grantable = eachBit(wanted).filter((bit) => PermissionStore.can(bit, guild as never));
    const permissions = grantable.reduce((bits, bit) => bits | bit, 0n);
    FluxDispatcher.dispatch({
        type: "GUILD_SETTINGS_ROLES_UPDATE_PERMISSION_SET",
        id: role.id,
        permissions,
    });
    const skipped = eachBit(wanted).length - grantable.length;
    showToast(
        skipped
            ? `Applied ${template.name}, without ${skipped} permission${skipped === 1 ? "" : "s"} you don't have. Save to keep it.`
            : `Applied ${template.name}. Save to keep it.`,
        skipped ? "message" : "success",
    );
}

function PermissionTemplates({ guild, role, locked }: { guild: Guild; role: Role; locked: boolean }) {
    return (
        <div className="fosscord-role-templates">
            <div className="fosscord-role-templates-head">
                <Text variant="text-md/semibold" color="text-strong">
                    Permission templates
                </Text>
                <Text variant="text-sm/normal" color="text-muted">
                    Start from a template, then adjust the permissions below. This replaces the role's current permissions.
                </Text>
            </div>
            <div className="fosscord-role-templates-list" role="group" aria-label="Permission templates">
                {TEMPLATES.map((template) => {
                    const current = role.permissions === bitsOf(template.permissions);
                    return (
                        <button
                            key={template.name}
                            type="button"
                            className="fosscord-role-template"
                            aria-pressed={current}
                            disabled={locked}
                            onClick={() => apply(template, role, guild)}
                        >
                            <Text variant="text-sm/semibold" color="text-strong">
                                {template.name}
                            </Text>
                            <Text variant="text-xs/normal" color="text-muted">
                                {template.description}
                            </Text>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

export default definePlugin({
    name: "FosscordRoleTemplates",
    description: "Adds Member, Moderator, Staff and Manager permission templates to the Permissions tab of the role editor.",
    authors: [FosscordAuthor],
    required: true,
    managedStyle,

    renderTemplates(props: { guild: Guild; role: Role; locked: boolean }) {
        return <PermissionTemplates key="fosscord-role-templates" {...props} />;
    },

    patches: [
        {
            // the role editor's permission list, which opens with the "Clear permissions" button
            find: 't["UYq7+O"]',
            replacement: {
                match: /(children:\[)(\(0,\i\.jsx\)\(\i,\{guild:(\i),role:(\i),locked:(\i)\}\),\i\.map\()/,
                replace: "$1$self.renderTemplates({guild:$3,role:$4,locked:$5}),$2",
            },
        },
    ],
});
