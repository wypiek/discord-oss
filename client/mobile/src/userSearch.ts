type AnyRecord = Record<string, unknown>;

const asText = (value: unknown) => (typeof value === "string" ? value : typeof value === "number" || typeof value === "bigint" ? String(value) : null);

const cleanUser = (value: unknown): AnyRecord | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const user = value as AnyRecord;
    const id = asText(user.id);
    if (!id) return null;
    const globalName = asText(user.globalName);
    const nicknames: Record<string, string | null> = {};
    if (user.nicknames && typeof user.nicknames === "object" && !Array.isArray(user.nicknames)) {
        for (const [guildId, nick] of Object.entries(user.nicknames as AnyRecord)) nicknames[guildId] = asText(nick);
    }
    return {
        ...user,
        id,
        username: asText(user.username) ?? globalName ?? id,
        isBot: user.isBot === true,
        isFriend: user.isFriend === true,
        friendNickname: asText(user.friendNickname),
        globalName,
        nicknames,
    };
};

export const sanitizeUserSearchMessage = (json: string) => {
    let message: AnyRecord;
    try {
        message = JSON.parse(json) as AnyRecord;
    } catch {
        return json;
    }
    if (!message || message.type !== "UPDATE_USERS" || !Array.isArray(message.payload)) return json;
    const payload = message.payload.map(cleanUser).filter((user): user is AnyRecord => user !== null);
    return JSON.stringify({ ...message, payload });
};
