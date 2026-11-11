type ValidationError = { code: string; message: string };
type ValidationErrors = Record<string, ValidationError>;
type Node = Record<string, unknown>;

export const PAYLOAD_JSON_MAX_LENGTH = 1024 * 1024;
export const FILENAME_MAX_LENGTH = 1024;
export const SEARCH_CONTENT_MAX_LENGTH = 1024;
export const SEARCH_VALUE_MAX_LENGTH = 256;
export const SEARCH_VALUES_MAX_ITEMS = 100;
export const SEARCH_CHANNELS_MAX_ITEMS = 1000;
export const SEARCH_TAB_NAME_MAX_LENGTH = 64;
export const ID_MAX_LENGTH = 64;

const tooLong = (limit: number): ValidationError => ({ code: "BASE_TYPE_MAX_LENGTH", message: `Must be ${limit} or fewer in length.` });
const badLength = (minimum: number, maximum: number): ValidationError => ({ code: "BASE_TYPE_BAD_LENGTH", message: `Must be between ${minimum} and ${maximum} in length.` });
const isNode = (value: unknown): value is Node => !!value && typeof value === "object" && !Array.isArray(value);

function collector() {
    const errors: ValidationErrors = {};
    return {
        errors,
        text(value: unknown, maximum: number, field: string) {
            if (typeof value === "string" && value.length > maximum) errors[field] = tooLong(maximum);
        },
        list(value: unknown, maximum: number, field: string) {
            if (!Array.isArray(value)) return [];
            if (value.length > maximum) errors[field] = tooLong(maximum);
            return value.slice(0, maximum);
        },
        add(field: string, error: ValidationError) {
            errors[field] = error;
        },
    };
}

export function embedCharacterCount(embeds: unknown): number {
    if (!Array.isArray(embeds)) return 0;
    const length = (value: unknown) => (typeof value === "string" ? value.length : 0);
    return embeds.reduce((sum: number, embed: unknown) => {
        if (!isNode(embed)) return sum;
        const footer = isNode(embed.footer) ? embed.footer : {};
        const author = isNode(embed.author) ? embed.author : {};
        const fields = Array.isArray(embed.fields) ? embed.fields : [];
        return (
            sum +
            length(embed.title) +
            length(embed.description) +
            length(footer.text) +
            length(author.name) +
            fields.reduce((total: number, field: unknown) => total + (isNode(field) ? length(field.name) + length(field.value) : 0), 0)
        );
    }, 0);
}

export function readPayloadJson(body: unknown, files: { originalname?: string }[] = []): { body: unknown; errors?: ValidationErrors } {
    const check = collector();
    files.forEach((file, index) => check.text(file?.originalname, FILENAME_MAX_LENGTH, `files[${index}].filename`));
    const raw = isNode(body) ? body.payload_json : undefined;
    if (!raw) return Object.keys(check.errors).length ? { body, errors: check.errors } : { body };
    if (typeof raw !== "string") check.add("payload_json", { code: "BASE_TYPE_STRING", message: "Must be a string." });
    else if (raw.length > PAYLOAD_JSON_MAX_LENGTH) check.add("payload_json", tooLong(PAYLOAD_JSON_MAX_LENGTH));
    if (Object.keys(check.errors).length) return { body, errors: check.errors };
    try {
        const parsed = JSON.parse(raw as string);
        if (isNode(parsed)) return { body: parsed };
    } catch {}
    return { body, errors: { payload_json: { code: "BASE_TYPE_INVALID", message: "Must be a JSON object." } } };
}

export function messageSearchErrors(query: Record<string, unknown>): ValidationErrors {
    const check = collector();
    for (const [key, value] of Object.entries(query ?? {})) {
        const values = Array.isArray(value) ? check.list(value, key === "channel_id" ? SEARCH_CHANNELS_MAX_ITEMS : SEARCH_VALUES_MAX_ITEMS, key) : [value];
        const maximum = key === "content" ? SEARCH_CONTENT_MAX_LENGTH : key === "channel_id" ? ID_MAX_LENGTH : SEARCH_VALUE_MAX_LENGTH;
        values.forEach((entry) => {
            if (entry !== undefined && entry !== null && `${entry}`.length > maximum) check.add(key, tooLong(maximum));
        });
    }
    return check.errors;
}

export function searchTabErrors(tabs: unknown): ValidationErrors {
    const check = collector();
    if (isNode(tabs)) for (const name of Object.keys(tabs)) check.text(name, SEARCH_TAB_NAME_MAX_LENGTH, "tabs");
    return check.errors;
}

export function interactionRequestErrors(body: unknown): ValidationErrors {
    const check = collector();
    if (!isNode(body)) return check.errors;
    check.text(body.nonce, 25, "nonce");
    check.text(body.session_id, 128, "session_id");
    for (const key of ["application_id", "channel_id", "guild_id", "message_id"]) check.text(body[key], ID_MAX_LENGTH, key);
    for (const key of ["analytics_location", "section_name", "source"]) check.text(body[key], 100, key);
    const data = body.data;
    if (!isNode(data)) return check.errors;
    check.text(data.id, ID_MAX_LENGTH, "data.id");
    check.text(data.target_id, ID_MAX_LENGTH, "data.target_id");
    check.text(data.version, ID_MAX_LENGTH, "data.version");
    check.text(data.name, 100, "data.name");
    check.text(data.custom_id, 100, "data.custom_id");
    check.list(data.values, 25, "data.values").forEach((value, index) => check.text(value, 100, `data.values[${index}]`));
    check.list(data.attachments, 25, "data.attachments").forEach((attachment, index) => {
        if (!isNode(attachment)) return;
        check.text(attachment.id, ID_MAX_LENGTH, `data.attachments[${index}].id`);
        check.text(attachment.filename, FILENAME_MAX_LENGTH, `data.attachments[${index}].filename`);
        check.text(attachment.uploaded_filename, FILENAME_MAX_LENGTH, `data.attachments[${index}].uploaded_filename`);
    });
    const options = (value: unknown, field: string, depth: number) => {
        if (value === undefined) return;
        if (depth > 3) {
            check.add(field, { code: "BASE_TYPE_MAX_LENGTH", message: "Options can only be nested 3 levels deep." });
            return;
        }
        check.list(value, 25, field).forEach((option, index) => {
            if (!isNode(option)) return;
            check.text(option.name, 32, `${field}[${index}].name`);
            check.text(option.value, 6000, `${field}[${index}].value`);
            options(option.options, `${field}[${index}].options`, depth + 1);
        });
    };
    options(data.options, "data.options", 1);
    let count = 0;
    const submitted = (nodes: unknown[], field: string, depth: number) =>
        nodes.forEach((node, index) => {
            const path = `${field}[${index}]`;
            if (!isNode(node)) return;
            if (++count > 25 || depth > 3) {
                check.add("data.components", tooLong(25));
                return;
            }
            check.text(node.custom_id, 100, `${path}.custom_id`);
            check.text(node.value, 4000, `${path}.value`);
            check.list(node.values, 25, `${path}.values`).forEach((value, valueIndex) => check.text(value, 100, `${path}.values[${valueIndex}]`));
            submitted(check.list(node.components, 5, `${path}.components`), `${path}.components`, depth + 1);
            if (node.component !== undefined) submitted([node.component], `${path}.component`, depth + 1);
        });
    submitted(check.list(data.components, 5, "data.components"), "data.components", 1);
    return check.errors;
}

export function modalComponentErrors(components: unknown): ValidationErrors {
    const check = collector();
    let count = 0;
    const known = new Set(["custom_id", "label", "description", "placeholder", "value", "content"]);
    const visit = (nodes: unknown[], field: string, depth: number) =>
        nodes.forEach((node, index) => {
            const path = `${field}[${index}]`;
            if (!isNode(node)) return;
            if (++count > 25 || depth > 3) {
                check.add("data.components", tooLong(25));
                return;
            }
            const type = node.type;
            check.text(node.custom_id, 100, `${path}.custom_id`);
            check.text(node.label, type === 4 || type === 18 ? 45 : 100, `${path}.label`);
            check.text(node.description, 100, `${path}.description`);
            check.text(node.placeholder, type === 4 ? 100 : 150, `${path}.placeholder`);
            check.text(node.value, 4000, `${path}.value`);
            check.text(node.content, 4000, `${path}.content`);
            for (const [key, value] of Object.entries(node)) if (!known.has(key)) check.text(value, 2048, `${path}.${key}`);
            check.list(node.options, 25, `${path}.options`).forEach((option, optionIndex) => {
                if (!isNode(option)) return;
                for (const key of ["label", "value", "description"]) check.text(option[key], 100, `${path}.options[${optionIndex}].${key}`);
            });
            check.list(node.default_values, 25, `${path}.default_values`);
            visit(check.list(node.components, 5, `${path}.components`), `${path}.components`, depth + 1);
            if (node.component !== undefined) visit([node.component], `${path}.component`, depth + 1);
        });
    visit(check.list(components, 5, "data.components"), "data.components", 1);
    return check.errors;
}

export function commandLocalizationErrors(command: unknown, path = ""): ValidationErrors {
    const check = collector();
    const localizations = (value: unknown, maximum: number, field: string) => {
        if (!isNode(value)) return;
        for (const [locale, text] of Object.entries(value)) {
            if (locale.length > 16) check.add(field, { code: "BASE_TYPE_INVALID", message: "Localization keys must be locale codes." });
            if (typeof text !== "string" || text.length < 1 || text.length > maximum) check.add(`${field}.${locale.slice(0, 16)}`, badLength(1, maximum));
        }
    };
    const visit = (node: unknown, field: string, depth: number) => {
        if (!isNode(node)) return;
        localizations(node.name_localizations, 32, `${field}name_localizations`);
        localizations(node.description_localizations, 100, `${field}description_localizations`);
        check.list(node.choices, 25, `${field}choices`).forEach((choice, index) => {
            if (isNode(choice)) localizations(choice.name_localizations, 100, `${field}choices.${index}.name_localizations`);
        });
        const options = check.list(node.options, 25, `${field}options`);
        if (options.length && depth >= 3) {
            check.add(`${field}options`, { code: "BASE_TYPE_MAX_LENGTH", message: "Options can only be nested 3 levels deep." });
            return;
        }
        options.forEach((option, index) => visit(option, `${field}options.${index}.`, depth + 1));
    };
    visit(command, path, 0);
    return check.errors;
}

export function scheduledMessageErrors(payload: unknown): ValidationErrors {
    const check = collector();
    if (!isNode(payload)) return check.errors;
    check.text(payload.content, 4000, "content");
    check.list(payload.sticker_ids, 3, "sticker_ids");
    check.list(payload.attachments, 50, "attachments").forEach((attachment, index) => {
        if (!isNode(attachment)) return;
        const field = `attachments[${index}]`;
        check.text(attachment.id, ID_MAX_LENGTH, `${field}.id`);
        check.text(attachment.filename, FILENAME_MAX_LENGTH, `${field}.filename`);
        check.text(attachment.uploaded_filename, FILENAME_MAX_LENGTH, `${field}.uploaded_filename`);
        check.text(attachment.description, 1024, `${field}.description`);
        check.text(attachment.title, 256, `${field}.title`);
        check.text(attachment.waveform, 4096, `${field}.waveform`);
        check.text(attachment.original_content_type, 255, `${field}.original_content_type`);
    });
    if (isNode(payload.allowed_mentions)) {
        check.list(payload.allowed_mentions.parse, 3, "allowed_mentions.parse");
        check.list(payload.allowed_mentions.users, 100, "allowed_mentions.users");
        check.list(payload.allowed_mentions.roles, 100, "allowed_mentions.roles");
    }
    if (isNode(payload.message_reference))
        for (const key of ["message_id", "channel_id", "guild_id"]) check.text(payload.message_reference[key], ID_MAX_LENGTH, `message_reference.${key}`);
    if (isNode(payload.poll)) {
        const media = (value: unknown, maximum: number, field: string) => {
            if (!isNode(value)) return;
            check.text(value.text, maximum, `${field}.text`);
            if (isNode(value.emoji)) {
                check.text(value.emoji.id, ID_MAX_LENGTH, `${field}.emoji.id`);
                check.text(value.emoji.name, 64, `${field}.emoji.name`);
            }
        };
        media(payload.poll.question, 300, "poll.question");
        check
            .list(payload.poll.answers, 10, "poll.answers")
            .forEach((answer, index) => media(isNode(answer) ? answer.poll_media : undefined, 55, `poll.answers[${index}].poll_media`));
    }
    return check.errors;
}

export function clampEmbedText<T>(embeds: T[] | undefined): T[] | undefined {
    const clip = (node: Node, key: string, maximum: number) => {
        const value = node[key];
        if (typeof value === "string" && value.length > maximum) node[key] = `${value.slice(0, maximum - 3)}...`;
    };
    embeds?.forEach((embed) => {
        if (!isNode(embed)) return;
        clip(embed, "title", 256);
        clip(embed, "description", 4096);
        if (isNode(embed.author)) clip(embed.author, "name", 256);
        if (isNode(embed.footer)) clip(embed.footer, "text", 2048);
        if (Array.isArray(embed.fields))
            embed.fields.forEach((field) => {
                if (!isNode(field)) return;
                clip(field, "name", 256);
                clip(field, "value", 1024);
            });
    });
    return embeds;
}
