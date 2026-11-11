import { Request, Response, Router } from "express";
import { PreloadedUserSettings } from "discord-protos";
import { JsonValue } from "@protobuf-ts/runtime";
import { route } from "@spacebar/api/middlewares";
import { UserSettingsProtos } from "@spacebar/database";
import { FieldErrors, OrmUtils } from "@spacebar/util";
import { assertMaxLength, UserFieldCaps } from "@spacebar/util/util/UserFieldCaps";
import { SettingsProtoJsonResponse, SettingsProtoResponse, SettingsProtoUpdateJsonSchema, SettingsProtoUpdateSchema } from "@spacebar/schemas";

const router: Router = Router({ mergeParams: true });

const parseSettings = (parse: () => PreloadedUserSettings) => {
    let settings: PreloadedUserSettings;
    try {
        settings = parse();
    } catch {
        throw FieldErrors({
            settings: { code: "BASE_TYPE_INVALID", message: "Invalid settings payload." },
        });
    }
    const customStatus = settings.status?.customStatus;
    assertMaxLength("status.custom_status.text", customStatus?.text, UserFieldCaps.customStatusText);
    assertMaxLength("status.custom_status.emoji_name", customStatus?.emojiName, UserFieldCaps.customStatusEmojiName);
    return settings;
};

//#region Protobuf
router.get(
    "/",
    route({
        responses: {
            200: {
                body: "SettingsProtoResponse",
            },
        },
        query: {
            atomic: {
                type: "boolean",
                description: "Whether to try to apply the settings update atomically (default false)",
            },
        },
        spacebarOnly: false, // maps to /users/@me/settings-proto/1
    }),
    async (req: Request, res: Response) => {
        const userSettings = await UserSettingsProtos.getOrDefault(req.user_id);

        res.json({
            settings: PreloadedUserSettings.toBase64(userSettings.userSettings!),
        } satisfies SettingsProtoResponse);
    },
);

router.patch(
    "/",
    route({
        requestBody: "SettingsProtoUpdateSchema",
        responses: {
            200: {
                body: "SettingsProtoUpdateResponse",
            },
        },
        spacebarOnly: false, // maps to /users/@me/settings-proto/1
    }),
    async (req: Request, res: Response) => {
        const { settings, required_data_version } = req.body as SettingsProtoUpdateSchema;
        const { atomic } = req.query;
        const updatedSettings = parseSettings(() => PreloadedUserSettings.fromBase64(settings));

        const resultObj = await UserSettingsProtos.withLock(req.user_id, () => patchUserSettings(req.user_id, updatedSettings, required_data_version, atomic == "true"));

        res.json({
            settings: PreloadedUserSettings.toBase64(resultObj.settings),
            out_of_date: resultObj.out_of_date,
        });
    },
);

//#endregion
//#region JSON
router.get(
    "/json",
    route({
        responses: {
            200: {
                body: "SettingsProtoJsonResponse",
            },
        },
        spacebarOnly: true,
    }),
    async (req: Request, res: Response) => {
        const userSettings = await UserSettingsProtos.getOrDefault(req.user_id);

        res.json({
            settings: PreloadedUserSettings.toJson(userSettings.userSettings!),
        } satisfies SettingsProtoJsonResponse);
    },
);

router.patch(
    "/json",
    route({
        requestBody: "SettingsProtoUpdateJsonSchema",
        responses: {
            200: {
                body: "SettingsProtoUpdateJsonResponse",
            },
        },
        query: {
            atomic: {
                type: "boolean",
                description: "Whether to try to apply the settings update atomically (default false)",
            },
        },
        spacebarOnly: true,
    }),
    async (req: Request, res: Response) => {
        const { settings, required_data_version } = req.body as SettingsProtoUpdateJsonSchema;
        const { atomic } = req.query;
        const updatedSettings = parseSettings(() => PreloadedUserSettings.fromJson(settings));

        const resultObj = await UserSettingsProtos.withLock(req.user_id, () => patchUserSettings(req.user_id, updatedSettings, required_data_version, atomic == "true"));

        res.json({
            settings: PreloadedUserSettings.toJson(resultObj.settings),
            out_of_date: resultObj.out_of_date,
        });
    },
);

//#endregion

async function patchUserSettings(userId: string, updatedSettings: PreloadedUserSettings, required_data_version: number | undefined, atomic: boolean = false) {
    const userSettings = await UserSettingsProtos.getOrDefault(userId);
    let settings = userSettings.userSettings!;

    if (required_data_version && settings.versions && settings.versions.dataVersion > required_data_version) {
        return {
            settings: settings,
            out_of_date: true,
        };
    }

    if ((process.env.LOG_PROTO_UPDATES || process.env.LOG_PROTO_SETTINGS_UPDATES) && process.env.LOG_PROTO_SETTINGS_UPDATES !== "false")
        console.log(`Updating user settings for user ${userId} with atomic=${atomic}:`, updatedSettings);

    if (!atomic) {
        settings = PreloadedUserSettings.fromJson(
            Object.assign(PreloadedUserSettings.toJson(settings) as object, PreloadedUserSettings.toJson(updatedSettings) as object) as JsonValue,
        );
    } else {
        settings = PreloadedUserSettings.fromJson(
            OrmUtils.mergeDeep(PreloadedUserSettings.toJson(settings) as object, PreloadedUserSettings.toJson(updatedSettings) as object) as JsonValue,
        );
    }

    settings = await userSettings.commitUserSettings(settings, updatedSettings.versions?.clientVersion);

    return {
        settings: settings,
        out_of_date: false,
    };
}

export default router;
