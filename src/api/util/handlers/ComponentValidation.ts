type Component = Record<string, any>;
type ValidationError = { code: string; message: string };
export const COMPONENTS_V2 = 32768;

export function componentMessageErrors(
    message: {
        flags?: number;
        content?: unknown;
        embeds?: unknown;
        embed?: unknown;
        poll?: unknown;
        sticker_ids?: unknown;
    },
    previousFlags = 0,
) {
    const errors: Record<string, ValidationError> = {};
    const fail = (field: string, message: string) => {
        errors[field] = { code: "COMPONENT_VALIDATION_FAILED", message };
    };
    if (previousFlags & COMPONENTS_V2 && message.flags !== undefined && !(message.flags & COMPONENTS_V2)) fail("flags", "The components v2 flag cannot be removed.");
    if ((message.flags ?? previousFlags) & COMPONENTS_V2) {
        if (message.content) fail("content", "Components v2 messages use text display components instead of content.");
        if ((Array.isArray(message.embeds) && message.embeds.length) || message.embed) fail("embeds", "Components v2 messages use containers instead of embeds.");
        if (message.poll) fail("poll", "Components v2 messages cannot include polls.");
        if (Array.isArray(message.sticker_ids) && message.sticker_ids.length) fail("sticker_ids", "Components v2 messages cannot include stickers.");
    }
    return errors;
}

export function messageComponentErrors(components: unknown, flags: number) {
    const errors: Record<string, ValidationError> = {};
    const fail = (field: string, message: string) => {
        errors[field] = { code: "COMPONENT_VALIDATION_FAILED", message };
    };
    if (!Array.isArray(components)) {
        fail("components", "Components must be an array.");
        return errors;
    }
    const v2 = !!(flags & COMPONENTS_V2);
    if (!v2 && components.length > 5) fail("components", "Legacy messages allow up to five action rows.");
    const ids = new Set<number>();
    const customs = new Set<string>();
    let count = 0;
    const text = (value: unknown, minimum: number, maximum: number, field: string) => {
        if (typeof value !== "string" || value.length < minimum || value.length > maximum) fail(field, `Must be a string between ${minimum} and ${maximum} characters.`);
    };
    const media = (value: unknown, field: string, file = false) => {
        const url = (value as Component)?.url;
        if (typeof url !== "string" || !URL.canParse(url) || !(file ? url.startsWith("attachment://") : ["https:", "http:", "attachment:"].includes(new URL(url).protocol)))
            fail(field, file ? "File components require an attachment:// reference." : "Media must use an HTTP, HTTPS or attachment URL.");
    };
    const visit = (node: Component, field: string, allowed: number[]) => {
        if (!node || typeof node !== "object" || Array.isArray(node)) {
            fail(field, "Component must be an object.");
            return;
        }
        if (++count > 40) {
            fail("components", "Messages allow up to 40 total components.");
            return;
        }
        if (!allowed.includes(node.type)) {
            fail(`${field}.type`, "Component type is not allowed in this position.");
            return;
        }
        if (node.id !== undefined) {
            if (!Number.isInteger(node.id) || node.id < 0 || node.id > 0xffffffff) fail(`${field}.id`, "Component IDs must be unsigned 32 bit integers.");
            else if (node.id !== 0) {
                if (ids.has(node.id)) fail(`${field}.id`, "Component IDs must be unique.");
                ids.add(node.id);
            }
        }
        if ([2, 3, 5, 6, 7, 8].includes(node.type) && !(node.type === 2 && node.style === 5)) {
            text(node.custom_id, 1, 100, `${field}.custom_id`);
            if (customs.has(node.custom_id)) fail(`${field}.custom_id`, "Custom IDs must be unique within a message.");
            customs.add(node.custom_id);
        }
        const children = (minimum: number, maximum: number, types: number[]) => {
            if (!Array.isArray(node.components) || node.components.length < minimum || node.components.length > maximum) {
                fail(`${field}.components`, `Must contain between ${minimum} and ${maximum} components.`);
                return;
            }
            node.components.forEach((child: Component, index: number) => visit(child, `${field}.components[${index}]`, types));
        };
        if (node.type === 1) {
            children(1, 5, [2, 3, 5, 6, 7, 8]);
            if (Array.isArray(node.components) && node.components.some((child: Component) => child?.type !== 2) && node.components.length !== 1)
                fail(`${field}.components`, "A select menu must occupy its own action row.");
        } else if (node.type === 2) {
            if (!Number.isInteger(node.style) || node.style < 1 || node.style > 5) fail(`${field}.style`, "Button style must be between 1 and 5.");
            if (node.style === 5) {
                text(node.url, 1, 512, `${field}.url`);
                if (typeof node.url === "string" && (!URL.canParse(node.url) || !["http:", "https:"].includes(new URL(node.url).protocol)))
                    fail(`${field}.url`, "Link buttons require an HTTP or HTTPS URL.");
                if (node.custom_id !== undefined) fail(`${field}.custom_id`, "Link buttons cannot have a custom ID.");
            } else if (node.url !== undefined) fail(`${field}.url`, "Interactive buttons cannot have a URL.");
            if (node.sku_id !== undefined) fail(`${field}.sku_id`, "Purchase buttons are unavailable on this instance.");
            if (node.label !== undefined) text(node.label, 1, 80, `${field}.label`);
            if (!node.label && !node.emoji) fail(field, "Buttons require a label or emoji.");
        } else if ([3, 5, 6, 7, 8].includes(node.type)) {
            const min = node.min_values ?? 1;
            const max = node.max_values ?? 1;
            if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < 1 || max > 25 || min > max)
                fail(field, "Select bounds must satisfy 0 <= min_values <= max_values <= 25.");
            if (node.placeholder !== undefined) text(node.placeholder, 0, 150, `${field}.placeholder`);
            if (node.type === 3) {
                if (!Array.isArray(node.options) || node.options.length < 1 || node.options.length > 25)
                    fail(`${field}.options`, "String selects require between 1 and 25 options.");
                else {
                    const values = new Set<string>();
                    node.options.forEach((option: Component, index: number) => {
                        text(option?.label, 1, 100, `${field}.options[${index}].label`);
                        text(option?.value, 1, 100, `${field}.options[${index}].value`);
                        if (option?.description !== undefined) text(option.description, 0, 100, `${field}.options[${index}].description`);
                        if (values.has(option?.value)) fail(`${field}.options[${index}].value`, "Option values must be unique.");
                        values.add(option?.value);
                    });
                    if (max > node.options.length) fail(`${field}.max_values`, "Cannot exceed the number of options.");
                }
            }
        } else if (node.type === 9) {
            children(1, 3, [10]);
            visit(node.accessory, `${field}.accessory`, [2, 11]);
        } else if (node.type === 10) text(node.content, 1, 4000, `${field}.content`);
        else if (node.type === 11) {
            media(node.media, `${field}.media`);
            if (node.description !== undefined) text(node.description, 0, 1024, `${field}.description`);
        } else if (node.type === 12) {
            if (!Array.isArray(node.items) || node.items.length < 1 || node.items.length > 10) fail(`${field}.items`, "Media galleries require between 1 and 10 items.");
            else
                node.items.forEach((item: Component, index: number) => {
                    media(item?.media, `${field}.items[${index}].media`);
                    if (item?.description !== undefined) text(item.description, 0, 1024, `${field}.items[${index}].description`);
                });
        } else if (node.type === 13) media(node.file, `${field}.file`, true);
        else if (node.type === 14 && node.spacing !== undefined && ![1, 2].includes(node.spacing)) fail(`${field}.spacing`, "Separator spacing must be 1 or 2.");
        else if (node.type === 17) {
            children(1, 39, [1, 9, 10, 12, 13, 14]);
            if (node.accent_color !== undefined && node.accent_color !== null && (!Number.isInteger(node.accent_color) || node.accent_color < 0 || node.accent_color > 0xffffff))
                fail(`${field}.accent_color`, "Accent color must be a 24 bit RGB value or null.");
        }
    };
    components.forEach((node, index) => visit(node, `components[${index}]`, v2 ? [1, 9, 10, 12, 13, 14, 17] : [1]));
    return errors;
}

export function findMessageComponent(components: unknown, customId: unknown, type: unknown): Component | undefined {
    if (!Array.isArray(components)) return;
    for (const node of components) {
        if (!node || typeof node !== "object") continue;
        if (node.custom_id === customId && node.type === type && !node.disabled && [2, 3, 5, 6, 7, 8].includes(node.type)) return node;
        const found = findMessageComponent([...(node.components ?? []), ...(node.accessory ? [node.accessory] : [])], customId, type);
        if (found) return found;
    }
}

export function messageComponentText(components: unknown): string {
    if (!Array.isArray(components)) return "";
    return components
        .flatMap((node) => {
            if (!node || typeof node !== "object") return [];
            if (node.type === 10 && typeof node.content === "string") return [node.content];
            return [messageComponentText(node.components)];
        })
        .filter(Boolean)
        .join("\n");
}
