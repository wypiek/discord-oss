import { BaseEntity, Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { Application } from "./Application";
import { Guild } from "./Guild";

export interface ApplicationCommandPermissionOverwrite {
    id: string;
    type: 1 | 2 | 3;
    permission: boolean;
}

@Entity({
    name: "application_command_permissions",
})
export class ApplicationCommandPermission extends BaseEntity {
    @PrimaryColumn({ type: "bigint" })
    id: string;

    @PrimaryColumn({ type: "bigint" })
    guild_id: string;

    @JoinColumn({
        name: "guild_id",
        foreignKeyConstraintName: "FK_application_command_permission_guild_id",
    })
    @ManyToOne(() => Guild, { onDelete: "CASCADE" })
    guild: Guild;

    @Column({ type: "bigint" })
    application_id: string;

    @JoinColumn({
        name: "application_id",
        foreignKeyConstraintName: "FK_application_command_permission_application_id",
    })
    @ManyToOne(() => Application, { onDelete: "CASCADE" })
    application: Application;

    @Column({ type: "jsonb", default: [] })
    permissions: ApplicationCommandPermissionOverwrite[];

    toJSON() {
        return {
            id: this.id,
            application_id: this.application_id,
            guild_id: this.guild_id,
            permissions: this.permissions,
        };
    }
}
