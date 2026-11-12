import { Session, User, UserSettings, UserSettingsProtos } from "@spacebar/database";
import { PreloadedUserSettings } from "discord-protos";
import { JsonObject } from "@protobuf-ts/runtime";
import { broadcastPresence, effectiveRights } from "@spacebar/util";
import { EntityManager, Not } from "typeorm";
import { UserSettingsUpdateSchema } from "@spacebar/schemas";

async function settablePresence(user_id: string, status: string) {
    if (["online", "idle", "dnd", "invisible"].includes(status)) return true;
    if (status !== "testing") return false;
    const user = await User.findOne({ where: { id: user_id }, select: { id: true, rights: true } });
    return (await effectiveRights(user_id, user?.rights)).has("TESTING_PRESENCE");
}

export async function updateUserPreferenceSettings(user_id: string, body: UserSettingsUpdateSchema, alsoInTransaction?: (manager: EntityManager) => Promise<unknown>) {
    if (body.locale === "en") body.locale = "en-US";

    const categories = Object.entries(UserSettings.toProtoCategories(body));
    const presence = body.status && (await settablePresence(user_id, body.status)) ? body.status : null;
    if (body.status === "testing" && !presence) delete body.status;

    const { user, settings, protos } = await UserSettingsProtos.withLock(user_id, () =>
        User.getRepository().manager.transaction(async (manager) => {
            const user = await manager.findOneOrFail(User, {
                where: { id: user_id, bot: false },
                relations: { settings: true },
            });

            const needsSettingsLink = !user.settings;
            if (!user.settings)
                user.settings = UserSettings.create<UserSettings>({
                    ...body,
                    friend_source_flags: body.friend_source_flags ?? { all: true },
                });
            else user.settings.assign(body);

            if (body.guild_folders) user.settings.guild_folders = body.guild_folders;

            await manager.save(user.settings);
            if (needsSettingsLink) await manager.createQueryBuilder().relation(User, "settings").of(user_id).set(user.settings.index);

            const protos = await UserSettingsProtos.getOrDefault(user_id, false, manager);
            if (categories.length) {
                const current = PreloadedUserSettings.toJson(protos.userSettings!) as JsonObject;
                for (const [category, values] of categories) current[category] = { ...(current[category] as JsonObject | undefined), ...values };
                protos.stageUserSettings(PreloadedUserSettings.fromJson(current));
                await manager.save(protos);
            }

            if (presence) await manager.update(Session, { user_id, status: Not("offline") }, { status: presence });
            await alsoInTransaction?.(manager);
            return { user, settings: user.settings, protos };
        }),
    );

    if (categories.length) await protos.announceUserSettings();
    if (presence) await broadcastPresence(user.id, user.toPublicUser());

    return settings.toLegacy(protos.userSettings);
}
