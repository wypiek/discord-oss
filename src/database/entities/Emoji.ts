import { Column, Entity, JoinColumn, ManyToOne, Index } from "typeorm";
import { BaseClass } from "./BaseClass";
import { Application } from "./Application";
import { Guild } from "./Guild";
import { User } from "./User";

@Entity({
    name: "emojis",
})
export class Emoji extends BaseClass {
    @Column()
    animated: boolean;

    @Column()
    available: boolean; // whether this emoji can be used, may be false due to various reasons

    @Column({ nullable: true })
    @Index("IDX_emojis_guild_id")
    guild_id: string | null;

    @JoinColumn({ name: "guild_id", foreignKeyConstraintName: "FK_emoji_guild_id" })
    @ManyToOne(
        () => Guild,
        (guild) => guild.emojis,
        {
            onDelete: "CASCADE",
            nullable: true,
        },
    )
    guild: Guild | null;

    @Column({ nullable: true })
    application_id: string | null;

    @JoinColumn({ name: "application_id", foreignKeyConstraintName: "FK_emoji_application_id" })
    @ManyToOne(
        () => Application,
        (application) => application.emojis,
        {
            onDelete: "CASCADE",
            nullable: true,
        },
    )
    application: Application | null;

    @Column({ nullable: true })
    user_id: string;

    @JoinColumn({ name: "user_id", foreignKeyConstraintName: "FK_emoji_user_id" })
    @ManyToOne(() => User)
    user: User;

    @Column()
    managed: boolean;

    @Column()
    name: string;

    @Column({ type: "bigint", default: 0 })
    version: string;

    @Column()
    require_colons: boolean;

    @Column({ type: "int8", array: true })
    roles: string[]; // roles this emoji is whitelisted to (new discord feature?)

    @Column({ type: "int8", array: true, nullable: true })
    groups: string[]; // user groups this emoji is whitelisted to (Spacebar extension)

    toJSON() {
        const json = super.toJSON();
        return { ...json, roles: json.roles ?? [], user: this.user?.toPublicUser?.() ?? undefined };
    }
}
