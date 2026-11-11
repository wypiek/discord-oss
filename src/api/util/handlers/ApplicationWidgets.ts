import { FindOptionsWhere, In } from "typeorm";
import { Application, ApplicationIdentity, ApplicationWidgetConfig, ApplicationWidgetField, ApplicationWidgetSurface, User } from "@spacebar/database";
import { Config, FieldErrors } from "@spacebar/util";
import { toPublicApplication } from "./Application";

// Application profile widgets, as Discord's client renders them. An application describes its card once
// (a layout per surface, each field either fixed text, an uploaded image or a key into per-user data),
// and each user's values come from their application identity.

export const MAX_WIDGET_ASSETS = 20;
export const MAX_WIDGET_TEXT = 256;
export const MAX_IDENTITY_KEYS = 50;
export const DATA_KEY = /^[A-Za-z0-9_]{1,32}$/;

type FieldKind = "text" | "media" | "number";
type Components = Record<string, Record<string, FieldKind>>;

const statFields: Record<string, FieldKind> = { text: "text", label: "text", icon: "media" };
const valueFields: Record<string, FieldKind> = { value: "text", label: "text", icon: "media" };
const itemFields: Record<string, FieldKind> = { image: "media", name: "text", description: "text" };
const headline: Components = {
    title: statFields,
    subtitle_1: statFields,
    subtitle_2: statFields,
    subtitle_3: statFields,
};

// Every layout the client knows, with the components it reads and the fields each component reads.
export const WIDGET_LAYOUTS: Record<string, Record<string, Components>> = {
    widget_top: {
        widget_top_hero: { ...headline, hero_image: { image: "media" } },
        widget_top_contained: { ...headline, contained_image: { image: "media" } },
    },
    widget_bottom: {
        widget_bottom_stats: Object.fromEntries([1, 2, 3, 4, 5, 6].map((i) => [`stat_${i}`, valueFields])),
        widget_bottom_progress: {
            objective: itemFields,
            progress: { current: "number", max: "number" },
        },
        widget_bottom_collection: Object.fromEntries([1, 2, 3, 4].map((i) => [`item_${i}`, itemFields])),
    },
    mini_profile: {
        mini_profile_hero_stat: { stat: statFields, hero_image: { image: "media" } },
        mini_profile_contained_stat: { stat: statFields, contained_image: { image: "media" } },
    },
    activity_accessory: {
        activity_accessory_stat: { stat: statFields },
    },
    add_widget_preview: {
        add_widget_preview_hero: { hero_image: { image: "media" } },
        add_widget_preview_contained: { contained_image: { image: "media" } },
    },
};

const invalid = (path: string, message: string) => FieldErrors({ [path]: { code: "BASE_TYPE_INVALID", message } });

function parseField(raw: unknown, kind: FieldKind, assetKeys: Set<string>, path: string, allowFallback = true): ApplicationWidgetField {
    if (!raw || typeof raw !== "object") throw invalid(path, "Invalid field.");
    const { value_type, presentation_type, value, fallback } = raw as Record<string, unknown>;
    if (typeof value !== "string" || !value || value.length > MAX_WIDGET_TEXT) throw invalid(path, `Must be between 1 and ${MAX_WIDGET_TEXT} characters long.`);

    let field: ApplicationWidgetField;
    if (value_type === "application_asset") {
        if (kind !== "media") throw invalid(path, "Images can only go in image fields.");
        if (!assetKeys.has(value)) throw invalid(path, "Unknown image.");
        field = { value_type, presentation_type: "image", value };
    } else if (value_type === "custom_string") {
        if (kind !== "text") throw invalid(path, "Text can only go in text fields.");
        field = { value_type, presentation_type: "text", value };
    } else if (value_type === "data") {
        if (!DATA_KEY.test(value)) throw invalid(path, "Data keys can only use letters, numbers and underscores, up to 32 characters.");
        const allowed = kind === "media" ? ["image"] : kind === "number" ? ["number"] : ["text", "number", "duration"];
        const presentation = typeof presentation_type === "string" && allowed.includes(presentation_type) ? presentation_type : allowed[0];
        field = {
            value_type,
            presentation_type: presentation as ApplicationWidgetField["presentation_type"],
            value,
        };
    } else throw invalid(path, "Invalid field type.");

    if (allowFallback && fallback != null) field.fallback = parseField(fallback, kind, assetKeys, `${path}.fallback`, false);
    return field;
}

// Checks a widget config sent by the developer portal against the layouts above and keeps only what the client reads.
export function parseWidgetSurfaces(raw: unknown, assetKeys: Set<string>) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalid("surfaces", "Invalid surfaces.");
    const surfaces: Record<string, ApplicationWidgetSurface> = {};
    for (const [surface, value] of Object.entries(raw as Record<string, unknown>)) {
        if (value == null) continue;
        const layouts = WIDGET_LAYOUTS[surface];
        if (!layouts) throw invalid(`surfaces.${surface}`, "Unknown surface.");
        const { layout, components } = value as { layout?: unknown; components?: unknown };
        const allowed = typeof layout === "string" ? layouts[layout] : undefined;
        if (!allowed) throw invalid(`surfaces.${surface}.layout`, "Unknown layout.");
        if (!components || typeof components !== "object") throw invalid(`surfaces.${surface}.components`, "Invalid components.");

        const parsed: ApplicationWidgetSurface["components"] = {};
        for (const [name, component] of Object.entries(components as Record<string, unknown>)) {
            if (component == null) continue;
            const fields = allowed[name];
            if (!fields) throw invalid(`surfaces.${surface}.components.${name}`, "This layout has no such component.");
            const rawFields = (component as { fields?: unknown }).fields;
            if (!rawFields || typeof rawFields !== "object") throw invalid(`surfaces.${surface}.components.${name}`, "Invalid component.");
            const out: Record<string, ApplicationWidgetField> = {};
            for (const [fieldName, field] of Object.entries(rawFields as Record<string, unknown>)) {
                if (field == null) continue;
                const kind = fields[fieldName];
                if (!kind) throw invalid(`surfaces.${surface}.components.${name}.fields.${fieldName}`, "This component has no such field.");
                out[fieldName] = parseField(field, kind, assetKeys, `surfaces.${surface}.components.${name}.fields.${fieldName}`);
            }
            if (Object.keys(out).length) parsed[name] = { fields: out };
        }
        surfaces[surface] = { layout: layout as string, components: parsed };
    }

    if (!surfaces.widget_top || !surfaces.widget_bottom) throw invalid("surfaces", "A widget needs a top and a bottom section.");
    // The Add Widget picker only lists widgets with a preview, so derive it from the top section's image.
    if (!surfaces.add_widget_preview) {
        const hero = surfaces.widget_top.layout === "widget_top_hero";
        const image = surfaces.widget_top.components[hero ? "hero_image" : "contained_image"];
        surfaces.add_widget_preview = {
            layout: hero ? "add_widget_preview_hero" : "add_widget_preview_contained",
            components: image ? { [hero ? "hero_image" : "contained_image"]: image } : {},
        };
    }
    return surfaces;
}

export const isWidgetComplete = (config?: ApplicationWidgetConfig | null): config is ApplicationWidgetConfig =>
    !!config?.surfaces?.widget_top && !!config.surfaces.widget_bottom && !!config.surfaces.add_widget_preview;

// The config object the client reads from /applications/:id/widget-configs and /widget-configs/*. `owned` puts the
// widgets someone made themselves in their own tab of the Add Widget picker (see FosscordApps).
export function toClientWidgetConfig(app: Application, viewerId?: string) {
    const config = app.widget_config!;
    return {
        config_id: config.config_id,
        application_id: app.id,
        application: toPublicApplication(app),
        surfaces: config.surfaces,
        resolved_assets: config.assets.map((asset) => ({
            key: asset.key,
            asset_id: asset.asset_id,
            application_id: app.id,
            updated_at: asset.updated_at,
            metadata: { width: asset.width, height: asset.height, is_animated: asset.is_animated },
        })),
        updated_at: config.updated_at,
        owned: app.owner_id === viewerId,
    };
}

// widget_config isn't selected by default, so it's read separately and attached.
export async function findWidgetApplications(where: FindOptionsWhere<Application> | FindOptionsWhere<Application>[], take = 100) {
    const configs = await Application.find({
        where,
        select: { id: true, widget_config: true },
        take: take * 2,
    });
    const complete = configs.filter((app) => isWidgetComplete(app.widget_config)).slice(0, take);
    if (!complete.length) return [];
    const apps = await Application.find({
        where: { id: In(complete.map((app) => app.id)) },
        relations: { bot: true },
    });
    return apps.map((app) => Object.assign(app, { widget_config: complete.find((x) => x.id === app.id)!.widget_config }));
}

// Who may put an application's widget on their profile: its owner, anyone the application has data for, or anyone at all once it's public.
export async function canUseWidget(app: Application, userId: string) {
    if (app.owner_id === userId || app.widget_public) return true;
    return ApplicationIdentity.exists({ where: { application_id: app.id, user_id: userId } });
}

export function parseIdentityData(raw: unknown) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalid("data", "Must be an object.");
    const entries = Object.entries(raw as Record<string, unknown>);
    if (entries.length > MAX_IDENTITY_KEYS) throw invalid("data", `Can have up to ${MAX_IDENTITY_KEYS} keys.`);
    const data: Record<string, string | number> = {};
    for (const [key, value] of entries) {
        if (!DATA_KEY.test(key)) throw invalid(`data.${key}`, "Keys can only use letters, numbers and underscores, up to 32 characters.");
        if (value == null) continue;
        if (typeof value === "number" && Number.isFinite(value)) data[key] = value;
        else if (typeof value === "string" && value.length <= MAX_WIDGET_TEXT) data[key] = value;
        else throw invalid(`data.${key}`, `Must be a number or a string of up to ${MAX_WIDGET_TEXT} characters.`);
    }
    return data;
}

const toClientIdentity = (applicationId: string, userId: string, identity?: ApplicationIdentity) => ({
    application_id: applicationId,
    user_id: userId,
    username: identity?.username ?? null,
    avatar_hash: null,
    metadata: null,
    profile: {
        username: identity?.username ?? undefined,
        data: {
            dynamic: Object.entries(identity?.data ?? {}).map(([name, value]) => ({
                name,
                type: typeof value === "number" ? 2 : 1,
                value,
            })),
        },
    },
});

// Identities for every application with data for the user, and for every widget on their profile or of their own
// applications even when there's no data for them, so widgets made only of fixed text and images still render.
export async function listUserIdentities(userId: string, viewerId?: string) {
    const self = userId === viewerId;
    const [user, ownIdentities, owned] = await Promise.all([
        User.findOne({ where: { id: userId }, select: { id: true, profile_widgets: true } }),
        self ? ApplicationIdentity.find({ where: { user_id: userId } }) : Promise.resolve([]),
        self ? Application.find({ where: { owner_id: userId }, select: { id: true } }) : Promise.resolve([]),
    ]);
    const widgetApps = (user?.profile_widgets ?? []).filter((w) => w.data.type === "application").map((w) => String(w.data.application_id));
    const ids = [...new Set([...widgetApps, ...ownIdentities.map((identity) => identity.application_id), ...owned.map((app) => app.id)])];
    if (!ids.length) return [];
    const [apps, identities] = await Promise.all([
        Application.find({ where: { id: In(ids) }, select: { id: true, widget_config: true } }),
        self ? Promise.resolve(ownIdentities) : ApplicationIdentity.find({ where: { user_id: userId, application_id: In(ids) } }),
    ]);
    const identityById = new Map(identities.map((identity) => [identity.application_id, identity]));
    const configById = new Map(apps.filter((app) => isWidgetComplete(app.widget_config)).map((app) => [app.id, app.widget_config!]));
    const surfaces = ["widget_top", "widget_bottom", "mini_profile", "activity_accessory", ...(self ? ["add_widget_preview"] : [])];
    return ids
        .filter((id) => configById.has(id))
        .map((id) => {
            const identity = identityById.get(id);
            const keys = new Set<string>();
            const include = (field: ApplicationWidgetField) => {
                if (field.value_type === "data") keys.add(field.value);
                if (field.fallback) include(field.fallback);
            };
            for (const surface of surfaces) {
                for (const component of Object.values(configById.get(id)!.surfaces[surface]?.components ?? {})) {
                    for (const field of Object.values(component.fields)) include(field);
                }
            }
            return toClientIdentity(
                id,
                userId,
                identity
                    ? Object.assign(new ApplicationIdentity(), identity, {
                          data: Object.fromEntries(Object.entries(identity.data).filter(([key]) => keys.has(key))),
                      })
                    : undefined,
            );
        });
}

// What a user's application widget showed, for a report: every text field as the reporter saw it, and its images.
export async function snapshotWidget(applicationId: string, userId: string) {
    const [app] = await findWidgetApplications({ id: applicationId }, 1);
    if (!app) return null;
    const identity = await ApplicationIdentity.findOne({
        where: { application_id: app.id, user_id: userId },
    });
    const lines: string[] = [];
    const images = new Set<string>();
    for (const surface of ["widget_top", "widget_bottom", "mini_profile", "activity_accessory"]) {
        for (const component of Object.values(app.widget_config!.surfaces[surface]?.components ?? {}))
            for (const field of Object.values(component.fields)) {
                const resolved = field.value_type === "data" && identity?.data[field.value] == null && field.fallback ? field.fallback : field;
                if (resolved.value_type === "application_asset") images.add(resolved.value);
                else if (resolved.value_type === "custom_string") lines.push(resolved.value);
                else lines.push(String(identity?.data[resolved.value] ?? `{{${resolved.value}}}`));
            }
    }
    const { endpointPublic } = Config.get().cdn;
    return {
        name: app.name,
        content: [...new Set(lines)].join("\n"),
        attachments: app
            .widget_config!.assets.filter((asset) => images.has(asset.key))
            .map((asset) => ({
                filename: `${asset.key}.png`,
                url: `${endpointPublic?.replace(/\/+$/, "")}/app-assets/${app.id}/${asset.asset_id}.png`,
                content_type: "image/png",
            })),
    };
}
