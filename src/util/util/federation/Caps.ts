import { AVATAR_CORNER_RADIUS_FIELD, readAvatarCornerRadius } from "../AvatarCornerRadius";

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw => !!value && typeof value === "object" && !Array.isArray(value);

export const REMOTE_LIST_LIMITS = {
    roles: 1000,
    channels: 1000,
    emojis: 1000,
    stickers: 500,
    members: 1000,
    voice_states: 1000,
    features: 100,
    activities: 10,
    embeds: 10,
    attachments: 25,
    mentions: 250,
    mention_roles: 250,
};

const clip = (raw: Raw, limits: Record<string, number>) => {
    for (const [key, max] of Object.entries(limits)) {
        const value = raw[key];
        if (typeof value === "string" && value.length > max) raw[key] = value.slice(0, max);
    }
    return raw;
};

const clipList = (raw: Raw, key: string, maxItems: number, each?: (item: Raw) => unknown) => {
    const value = raw[key];
    if (!Array.isArray(value)) return;
    const list = value.length > maxItems ? value.slice(0, maxItems) : value;
    raw[key] = list;
    if (each) for (const item of list) if (isRecord(item)) each(item);
};

const clipRecord = (raw: Raw, key: string, limits: Record<string, number>) => {
    const value = raw[key];
    if (isRecord(value)) clip(value, limits);
};

export function capRemoteDeep(value: unknown, depth = 0): unknown {
    if (typeof value === "string") return value.length > 2048 ? value.slice(0, 2048) : value;
    if (depth >= 8) return Array.isArray(value) || isRecord(value) ? null : value;
    if (Array.isArray(value)) return value.slice(0, 100).map((entry) => capRemoteDeep(entry, depth + 1));
    if (isRecord(value))
        return Object.fromEntries(
            Object.entries(value)
                .slice(0, 100)
                .map(([key, entry]) => [key.slice(0, 64), capRemoteDeep(entry, depth + 1)]),
        );
    return value;
}

export function capRemoteUser(user: Raw) {
    clip(user, { global_name: 32, pronouns: 40, bio: 190, avatar: 128, banner: 128 });
    clipRecord(user, "primary_guild", { tag: 32, badge: 128, identity_guild_id: 20 });
    if (AVATAR_CORNER_RADIUS_FIELD in user) user[AVATAR_CORNER_RADIUS_FIELD] = readAvatarCornerRadius(user[AVATAR_CORNER_RADIUS_FIELD]);
    return user;
}

export function capRemoteMember(member: Raw) {
    clip(member, { nick: 32, avatar: 128, banner: 128, bio: 190, pronouns: 40 });
    if (isRecord(member.user)) capRemoteUser(member.user);
    return member;
}

export function capRemoteRole(role: Raw) {
    clip(role, { name: 100, icon: 128, unicode_emoji: 32, description: 300 });
    if (isRecord(role.colors)) {
        const colors = role.colors;
        role.colors = Object.fromEntries(
            ["primary_color", "secondary_color", "tertiary_color"].flatMap((key) => (typeof colors[key] === "number" || colors[key] === null ? [[key, colors[key]]] : [])),
        );
    }
    return role;
}

export function capRemoteChannel(channel: Raw) {
    clip(channel, { name: 100, topic: 4096, icon: 128, status: 500, last_pin_timestamp: 64 });
    clipList(channel, "available_tags", 20, (tag) => clip(tag, { name: 20, emoji_name: 32, emoji_id: 20 }));
    clipRecord(channel, "default_reaction_emoji", { emoji_name: 32, emoji_id: 20 });
    if (Array.isArray(channel.recipients)) for (const user of channel.recipients) if (isRecord(user)) capRemoteUser(user);
    return channel;
}

export function capRemoteEmoji(emoji: Raw) {
    clip(emoji, { name: 32 });
    clipList(emoji, "roles", 250);
    return emoji;
}

export function capRemoteSticker(sticker: Raw) {
    return clip(sticker, { name: 30, description: 100, tags: 200 });
}

export function capRemoteActivity(activity: Raw) {
    clip(activity, { name: 128, state: 128, details: 128, url: 512, application_id: 20, platform: 32, sync_id: 64, session_id: 64 });
    clipRecord(activity, "emoji", { name: 32, id: 20 });
    clipRecord(activity, "assets", { large_text: 128, small_text: 128, large_image: 512, small_image: 512 });
    clipRecord(activity, "party", { id: 128 });
    if (Array.isArray(activity.buttons))
        activity.buttons = activity.buttons
            .slice(0, 2)
            .map((button) => (typeof button === "string" ? button.slice(0, 32) : isRecord(button) ? clip(button, { label: 32, url: 512 }) : button));
    return activity;
}

export function capRemoteEmbed(embed: Raw) {
    clip(embed, { title: 256, description: 4096, url: 2048, type: 32 });
    clipRecord(embed, "footer", { text: 2048, icon_url: 2048 });
    clipRecord(embed, "author", { name: 256, url: 2048, icon_url: 2048 });
    clipRecord(embed, "provider", { name: 256, url: 2048 });
    for (const key of ["image", "thumbnail", "video"]) clipRecord(embed, key, { url: 2048, proxy_url: 2048 });
    clipList(embed, "fields", 25, (field) => clip(field, { name: 256, value: 1024 }));
    return embed;
}

export function capRemoteMessage(message: Raw, maxContent: number) {
    clip(message, { content: maxContent, nonce: 64 });
    if (isRecord(message.author)) capRemoteUser(message.author);
    if (isRecord(message.member)) capRemoteMember(message.member);
    clipList(message, "embeds", REMOTE_LIST_LIMITS.embeds, capRemoteEmbed);
    clipList(message, "attachments", REMOTE_LIST_LIMITS.attachments, (attachment) => clip(attachment, { filename: 255, title: 1024, description: 1024, content_type: 255 }));
    clipList(message, "mentions", REMOTE_LIST_LIMITS.mentions, capRemoteUser);
    clipList(message, "mention_roles", REMOTE_LIST_LIMITS.mention_roles);
    return message;
}

export function capRemoteGuild(guild: Raw) {
    clip(guild, {
        name: 100,
        description: 300,
        vanity_url_code: 32,
        icon: 128,
        splash: 128,
        banner: 128,
        discovery_splash: 128,
        preferred_locale: 16,
        region: 64,
    });
    if (Array.isArray(guild.features))
        guild.features = guild.features.slice(0, REMOTE_LIST_LIMITS.features).map((feature) => (typeof feature === "string" ? feature.slice(0, 64) : feature));
    if (isRecord(guild.welcome_screen)) {
        clip(guild.welcome_screen, { description: 140 });
        clipList(guild.welcome_screen, "welcome_channels", 5, (channel) => clip(channel, { description: 50, emoji_name: 32, emoji_id: 20, channel_id: 20 }));
    }
    for (const key of ["profile", "home_settings", "onboarding", "member_verification", "discovery_metadata", "theme", "incidents_data"])
        if (key in guild && guild[key] !== null) guild[key] = capRemoteDeep(guild[key]);
    if (isRecord(guild.properties)) capRemoteGuild(guild.properties);
    clipList(guild, "roles", REMOTE_LIST_LIMITS.roles, capRemoteRole);
    clipList(guild, "channels", REMOTE_LIST_LIMITS.channels, capRemoteChannel);
    clipList(guild, "threads", REMOTE_LIST_LIMITS.channels, capRemoteChannel);
    clipList(guild, "emojis", REMOTE_LIST_LIMITS.emojis, capRemoteEmoji);
    clipList(guild, "stickers", REMOTE_LIST_LIMITS.stickers, capRemoteSticker);
    clipList(guild, "members", REMOTE_LIST_LIMITS.members, capRemoteMember);
    clipList(guild, "voice_states", REMOTE_LIST_LIMITS.voice_states, (state) => (isRecord(state.member) ? capRemoteMember(state.member) : state));
    if (isRecord(guild.member)) capRemoteMember(guild.member);
    return guild;
}

export function capRemoteInvite(invite: Raw) {
    if (isRecord(invite.guild)) capRemoteGuild(invite.guild);
    if (isRecord(invite.channel)) capRemoteChannel(invite.channel);
    if (isRecord(invite.inviter)) capRemoteUser(invite.inviter);
    if (isRecord(invite.profile)) invite.profile = capRemoteDeep(invite.profile);
    return invite;
}

export function capRemoteEvent(event: string, data: Raw, maxContent: number) {
    if (isRecord(data.user)) capRemoteUser(data.user);
    if (isRecord(data.member)) capRemoteMember(data.member);
    switch (event) {
        case "GUILD_CREATE":
        case "GUILD_UPDATE":
            return capRemoteGuild(data);
        case "GUILD_ROLE_CREATE":
        case "GUILD_ROLE_UPDATE":
            if (isRecord(data.role)) capRemoteRole(data.role);
            return data;
        case "GUILD_MEMBER_ADD":
        case "GUILD_MEMBER_UPDATE":
            return capRemoteMember(data);
        case "GUILD_EMOJIS_UPDATE":
            clipList(data, "emojis", REMOTE_LIST_LIMITS.emojis, capRemoteEmoji);
            return data;
        case "GUILD_STICKERS_UPDATE":
            clipList(data, "stickers", REMOTE_LIST_LIMITS.stickers, capRemoteSticker);
            return data;
        case "CHANNEL_CREATE":
        case "CHANNEL_UPDATE":
        case "CHANNEL_DELETE":
        case "THREAD_CREATE":
        case "THREAD_UPDATE":
            return capRemoteChannel(data);
        case "PRESENCE_UPDATE":
            clipList(data, "activities", REMOTE_LIST_LIMITS.activities, capRemoteActivity);
            return data;
        case "VOICE_STATE_UPDATE":
            return clip(data, { session_id: 64 });
        case "MESSAGE_CREATE":
        case "MESSAGE_UPDATE":
            return capRemoteMessage(data, maxContent);
        default:
            return data;
    }
}
