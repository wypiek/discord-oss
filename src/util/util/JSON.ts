// Discord.com sends ISO strings with +00:00 extension, not Z
// This causes issues with Python bot libs

export function JSONReplacer(this: { [key: string]: unknown }, key: string, value: unknown) {
    if (this[key] instanceof Date) {
        return (this[key] as Date).toISOString().replace("Z", "+00:00");
    }

    // erlpack encoding doesn't call json.stringify,
    // so our toJSON functions don't get called.
    // manually call it here
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    //@ts-ignore
    if (this?.[key]?.toJSON)
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        this[key] = this[key].toJSON();

    return value;
}

function discordDate(this: Date) {
    return Number.isNaN(this.getTime()) ? null : this.toISOString().replace("Z", "+00:00");
}

export function JSONStringify(value: unknown) {
    const toJSON = Date.prototype.toJSON;
    Date.prototype.toJSON = discordDate as typeof toJSON;
    try {
        return JSON.stringify(value);
    } finally {
        Date.prototype.toJSON = toJSON;
    }
}
