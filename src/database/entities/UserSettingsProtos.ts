import { Column, Entity, EntityManager, JoinColumn, OneToOne, PrimaryColumn } from "typeorm";
import { BaseClassWithoutId } from "./BaseClass";
import { User } from "./User";
import { FrecencyUserSettings, PreloadedUserSettings } from "discord-protos";
import { emitEvent } from "@spacebar/util";

@Entity({
    name: "user_settings_protos",
})
export class UserSettingsProtos extends BaseClassWithoutId {
    @OneToOne(() => User, {
        cascade: true,
        orphanedRowAction: "delete",
        eager: false,
    })
    @JoinColumn({ name: "user_id", foreignKeyConstraintName: "FK_user_settings_proto_user_id" })
    user: User;

    @PrimaryColumn({ type: "text" })
    user_id: string;

    @Column({ nullable: true, type: String, name: "userSettings" })
    _userSettings: string | undefined;

    @Column({ nullable: true, type: String, name: "frecencySettings" })
    _frecencySettings: string | undefined;

    // @Column({nullable: true, type: "simple-json"})
    // testSettings: {};

    bigintReplacer(_key: string, value: unknown): unknown {
        if (typeof value === "bigint") {
            return (value as bigint).toString();
        } else if (value instanceof Uint8Array) {
            return {
                __type: "Uint8Array",
                data: Array.from(value as Uint8Array)
                    .map((b) => b.toString(16).padStart(2, "0"))
                    .join(""),
            };
        } else {
            return value;
        }
    }

    bigintReviver(_key: string, value: unknown): unknown {
        if (typeof value === "string" && /^\d+n$/.test(value)) {
            return BigInt((value as string).slice(0, -1));
        } else if (typeof value === "object" && value !== null && "__type" in value) {
            if (value.__type === "Uint8Array" && "data" in value) {
                return new Uint8Array((value.data as string).match(/.{1,2}/g)!.map((byte: string) => parseInt(byte, 16)));
            }
        }
        return value;
    }

    get userSettings(): PreloadedUserSettings | undefined {
        if (!this._userSettings) return undefined;
        return PreloadedUserSettings.fromJson(JSON.parse(this._userSettings, this.bigintReviver));
    }

    set userSettings(value: PreloadedUserSettings | undefined) {
        if (value) {
            // this._userSettings = JSON.stringify(value, this.bigintReplacer);
            this._userSettings = PreloadedUserSettings.toJsonString(value);
        } else {
            this._userSettings = undefined;
        }
    }

    get frecencySettings(): FrecencyUserSettings | undefined {
        if (!this._frecencySettings) return undefined;
        return FrecencyUserSettings.fromJson(JSON.parse(this._frecencySettings, this.bigintReviver));
    }

    set frecencySettings(value: FrecencyUserSettings | undefined) {
        if (value) {
            this._frecencySettings = JSON.stringify(value, this.bigintReplacer);
        } else {
            this._frecencySettings = undefined;
        }
    }

    async commitUserSettings(settings: PreloadedUserSettings, clientVersion?: number) {
        this.stageUserSettings(settings, clientVersion);
        await this.save();
        await this.announceUserSettings();
        return settings;
    }

    stageUserSettings(settings: PreloadedUserSettings, clientVersion?: number) {
        settings.versions = {
            clientVersion: clientVersion ?? settings.versions?.clientVersion ?? 0,
            serverVersion: settings.versions?.serverVersion ?? 0,
            dataVersion: (settings.versions?.dataVersion ?? 0) + 1,
        };
        this.userSettings = settings;
    }

    async announceUserSettings() {
        const settings = this.userSettings!;
        await emitEvent({
            user_id: this.user_id,
            event: "USER_SETTINGS_PROTO_UPDATE",
            data: {
                settings: {
                    proto: PreloadedUserSettings.toBase64(settings),
                    type: 1,
                },
                json_settings: {
                    proto: PreloadedUserSettings.toJson(settings),
                    type: "user_settings",
                },
                partial: false,
            },
        });
    }

    private static locks = new Map<string, Promise<unknown>>();

    static async withLock<T>(user_id: string, fn: () => Promise<T>): Promise<T> {
        const run = (UserSettingsProtos.locks.get(user_id) ?? Promise.resolve()).then(fn, fn);
        const tail = run.catch(() => undefined);
        UserSettingsProtos.locks.set(user_id, tail);
        try {
            return await run;
        } finally {
            if (UserSettingsProtos.locks.get(user_id) === tail) UserSettingsProtos.locks.delete(user_id);
        }
    }

    static async getOrDefault(user_id: string, save: boolean = false, manager: EntityManager = UserSettingsProtos.getRepository().manager): Promise<UserSettingsProtos> {
        await manager.findOneOrFail(User, {
            where: { id: user_id },
            select: { settings: true },
        });

        let userSettings = await manager.findOne(UserSettingsProtos, {
            where: { user_id },
        });

        let modified = false;
        if (!userSettings) {
            await manager.createQueryBuilder().insert().into(UserSettingsProtos).values({ user_id }).orIgnore().execute();
            userSettings = await manager.findOneOrFail(UserSettingsProtos, { where: { user_id } });
            modified = true;
        }

        if (!userSettings.userSettings) {
            userSettings.userSettings = PreloadedUserSettings.create({
                versions: {
                    dataVersion: 0,
                    clientVersion: 0,
                    serverVersion: 0,
                },
            });
            modified = true;
        }

        if (!userSettings.frecencySettings) {
            userSettings.frecencySettings = FrecencyUserSettings.create({
                versions: {
                    dataVersion: 0,
                    clientVersion: 0,
                    serverVersion: 0,
                },
            });
            modified = true;
        }

        if (modified && save) userSettings = await manager.save(userSettings);

        return userSettings;
    }
}
