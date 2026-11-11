import { Column, Entity } from "typeorm";
import { BaseClass } from "./BaseClass";
import type {
    ApplicationCommandHandlerType,
    ApplicationCommandOption,
    ApplicationCommandIndexPermissions,
    Snowflake,
    ApplicationIntegrationType,
    InteractionContextType,
} from "@spacebar/schemas";
import { ApplicationCommandType } from "@spacebar/schemas/api/bots/ApplicationCommandSchema";

@Entity({
    name: "application_commands",
})
export class ApplicationCommand extends BaseClass {
    @Column({ default: ApplicationCommandType.CHAT_INPUT })
    type?: ApplicationCommandType;

    @Column({ type: "int8" })
    application_id: Snowflake;

    @Column({ type: "int8", nullable: true })
    guild_id?: Snowflake;

    @Column()
    name: string;

    @Column({ nullable: true, type: "jsonb" })
    name_localizations?: Record<string, string>;

    @Column()
    description: string;

    @Column({ nullable: true, type: "jsonb" })
    description_localizations?: Record<string, string>;

    @Column({ type: "jsonb", default: [] })
    options: ApplicationCommandOption[];

    @Column({ nullable: true, type: String })
    default_member_permissions: string | null;

    /*
     * @deprecated
     */
    @Column({ default: true })
    dm_permission?: boolean;

    @Column({ nullable: true, type: "jsonb" })
    permissions?: ApplicationCommandIndexPermissions;

    @Column({ default: false })
    nsfw?: boolean;

    @Column({ nullable: true, type: "jsonb" })
    integration_types?: ApplicationIntegrationType[];

    @Column({ default: 0 })
    global_popularity_rank?: number;

    @Column({ nullable: true, type: "jsonb" })
    contexts?: InteractionContextType[];

    @Column({ type: "int8", default: 0n })
    version: Snowflake; // Is this really a snowflake though? "An autoincrementing version identifier updated during substantial record changes"

    @Column({ default: 0 })
    handler?: ApplicationCommandHandlerType;
}
