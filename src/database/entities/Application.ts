import { Column, Entity, JoinColumn, ManyToOne, OneToMany, OneToOne } from "typeorm";
import { BaseClass } from "./BaseClass";
import { Team } from "./Team";
import { User } from "./User";
import { Guild } from "./Guild";
import { Emoji } from "./Emoji";

export interface ApplicationAsset {
    id: string;
    name: string;
    type: number;
}

export interface ApplicationWidgetField {
    value_type: "data" | "custom_string" | "application_asset";
    presentation_type: "text" | "number" | "image" | "duration";
    value: string;
    fallback?: Omit<ApplicationWidgetField, "fallback"> | null;
}

export interface ApplicationWidgetSurface {
    layout: string;
    components: Record<string, { fields: Record<string, ApplicationWidgetField> }>;
}

export interface ApplicationWidgetAsset {
    key: string;
    asset_id: string;
    width: number;
    height: number;
    is_animated: boolean;
    updated_at: string;
}

export interface ApplicationWidgetConfig {
    config_id: string;
    surfaces: Partial<Record<string, ApplicationWidgetSurface>>;
    assets: ApplicationWidgetAsset[];
    updated_at: string;
}

@Entity({
    name: "applications",
})
export class Application extends BaseClass {
    @Column()
    name: string;

    @Column({ nullable: true })
    icon?: string;

    @Column({ nullable: true })
    description: string;

    @Column({ nullable: true })
    summary: string = "";

    @Column({ type: "jsonb", nullable: true })
    type?: object; // TODO: this type is bad

    @Column()
    hook: boolean = true;

    @Column()
    bot_public?: boolean = true;

    @Column()
    bot_require_code_grant?: boolean = false;

    @Column()
    verify_key: string;

    @Column({ type: "text", nullable: true, select: false })
    interactions_private_key?: string;

    @Column({ type: "varchar", nullable: true, select: false })
    client_secret_hash?: string | null;

    @JoinColumn({ name: "owner_id", foreignKeyConstraintName: "FK_application_owner_id" })
    @ManyToOne(() => User, { onDelete: "CASCADE" })
    owner: User;

    @Column({ type: "int8" })
    owner_id: string;

    // TODO: enum this? https://discord.com/developers/docs/resources/application#application-object-application-flags
    @Column()
    flags: number = 0;

    @Column({ type: "varchar", nullable: true, array: true })
    redirect_uris: string[] = [];

    @Column({ nullable: true })
    rpc_application_state: number = 0;

    @Column({ nullable: true })
    store_application_state: number = 1;

    @Column({ nullable: true })
    verification_state: number = 1;

    @Column({ nullable: true })
    interactions_endpoint_url?: string;

    @Column({ nullable: true })
    integration_public: boolean = true;

    @Column({ nullable: true })
    integration_require_code_grant: boolean = false;

    @Column({ nullable: true })
    discoverability_state: number = 1;

    @Column({ nullable: true })
    discovery_eligibility_flags: number = 2240;

    @JoinColumn({ name: "bot_user_id", foreignKeyConstraintName: "FK_application_bot_user_id" })
    @OneToOne(() => User, { onDelete: "CASCADE" })
    bot?: User;

    @Column({ type: "varchar", array: true, nullable: true })
    tags?: string[];

    @Column({ nullable: true })
    cover_image?: string; // the application's default rich presence invite cover image hash

    @Column({ type: "jsonb", nullable: true })
    install_params?: { scopes: string[]; permissions: string };

    @Column({ type: "jsonb", nullable: true })
    integration_types_config?: Partial<Record<"0" | "1", { oauth2_install_params?: { scopes: string[]; permissions: string } | null }>> | null;

    @Column({ nullable: true })
    terms_of_service_url?: string;

    @Column({ nullable: true })
    privacy_policy_url?: string;

    @Column({ nullable: true })
    guild_id?: string;

    @JoinColumn({ name: "guild_id", foreignKeyConstraintName: "FK_application_guild_id" })
    @ManyToOne(() => Guild)
    guild?: Guild; // guild to which the app is linked, e.g. a developer support server

    @Column({ nullable: true })
    custom_install_url?: string;

    @Column({ type: "jsonb", default: [] })
    assets: ApplicationAsset[];

    @Column({ type: "jsonb", nullable: true, select: false })
    widget_config?: ApplicationWidgetConfig | null;

    // lets people who aren't the owner put the widget on their profile
    @Column({ default: false })
    widget_public: boolean = false;

    //just for us

    //@Column({ type: "varchar", array: true, nullable: true })
    //rpc_origins?: string[];

    //@Column({ nullable: true })
    //primary_sku_id?: string; // if this application is a game sold, this field will be the id of the "Game SKU" that is created,

    //@Column({ nullable: true })
    //slug?: string; // if this application is a game sold, this field will be the URL slug that links to the store page

    @JoinColumn({ name: "team_id", foreignKeyConstraintName: "FK_application_team_id" })
    @ManyToOne(() => Team, {
        onDelete: "CASCADE",
        nullable: true,
    })
    team?: Team;

    @JoinColumn({ name: "emoji_ids" })
    @OneToMany(
        () => Emoji,
        (emoji: Emoji) => emoji.application,
        {
            cascade: true,
            orphanedRowAction: "delete",
            onDelete: "CASCADE",
        },
    )
    emojis: Emoji[];
}
