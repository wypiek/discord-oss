import { Column, Entity, JoinColumn, ManyToOne, Index } from "typeorm";

import { BaseClass } from "./BaseClass";
import { Guild } from "./Guild";
import { RoleColors } from "@spacebar/schemas";

@Entity({
    name: "roles",
})
export class Role extends BaseClass {
    @Column()
    @Index("IDX_roles_guild_id")
    guild_id: string;

    @JoinColumn({ name: "guild_id", foreignKeyConstraintName: "FK_role_guild_id" })
    @ManyToOne(
        () => Guild,
        (guild) => guild.roles,
        {
            onDelete: "CASCADE",
        },
    )
    guild: Guild;

    @Column()
    color: number;

    @Column()
    hoist: boolean;

    @Column({ default: false })
    managed: boolean;

    @Column()
    mentionable: boolean;

    @Column()
    name: string;

    @Column()
    permissions: string;

    @Column()
    position: number;

    @Column({ nullable: true })
    icon?: string;

    @Column({ nullable: true })
    unicode_emoji?: string;

    @Column({ type: "jsonb", nullable: true })
    tags?: {
        bot_id?: string;
        integration_id?: string;
        premium_subscriber?: boolean;
    };

    @Column({ default: 0 })
    flags: number;

    @Column({ type: "bigint", default: 0 })
    version: string;

    @Column({ nullable: false, type: "jsonb" })
    colors: RoleColors;

    toJSON(): Role {
        return {
            ...this,
            tags: this.tags ?? undefined,
        };
    }
}
