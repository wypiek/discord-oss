import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, OneToOne, PrimaryColumn, Unique } from "typeorm";
import { BaseClass, BaseClassWithoutId } from "./BaseClass";
import { Application } from "./Application";
import { Channel } from "./Channel";
import { User } from "./User";

export interface ActivityUrlMapping {
    prefix: string;
    target: string;
}

export interface ActivityAsset {
    id: string;
    name: string;
    type: number;
}

@Entity({ name: "embedded_activities" })
export class EmbeddedActivity extends BaseClassWithoutId {
    @PrimaryColumn({ type: "int8" })
    application_id: string;

    @JoinColumn({
        name: "application_id",
        foreignKeyConstraintName: "FK_embedded_activity_application_id",
    })
    @OneToOne(() => Application, { onDelete: "CASCADE" })
    application: Application;

    @Column({ type: "varchar", nullable: true, unique: true })
    builtin?: string | null;

    @Column({ type: "jsonb", default: [] })
    url_mappings: ActivityUrlMapping[];

    @Column({ type: "jsonb", default: {} })
    config: Record<string, unknown>;

    @Column({ type: "jsonb", default: [] })
    assets: ActivityAsset[];

    @Column({ type: "int", default: 0 })
    shelf_rank: number;

    @Column({ default: true })
    on_shelf: boolean;
}

@Entity({ name: "activity_instances" })
@Unique("UQ_activity_instance_application_channel", ["application_id", "channel_id"])
export class ActivityInstance extends BaseClass {
    @Column({ type: "int8" })
    application_id: string;

    @JoinColumn({
        name: "application_id",
        foreignKeyConstraintName: "FK_activity_instance_application_id",
    })
    @ManyToOne(() => Application, { onDelete: "CASCADE" })
    application: Application;

    @Column({ type: "int8" })
    @Index("IDX_activity_instances_channel_id")
    channel_id: string;

    @JoinColumn({ name: "channel_id", foreignKeyConstraintName: "FK_activity_instance_channel_id" })
    @ManyToOne(() => Channel, { onDelete: "CASCADE" })
    channel: Channel;

    @Column({ type: "int8", nullable: true })
    @Index("IDX_activity_instances_guild_id")
    guild_id?: string | null;

    @Column({ type: "timestamp with time zone", default: () => "now()" })
    created_at: Date;

    @OneToMany(
        () => ActivityInstanceParticipant,
        (participant) => participant.instance,
    )
    participants: ActivityInstanceParticipant[];
}

@Entity({ name: "activity_instance_participants" })
export class ActivityInstanceParticipant extends BaseClassWithoutId {
    @PrimaryColumn({ type: "int8" })
    instance_id: string;

    @JoinColumn({
        name: "instance_id",
        foreignKeyConstraintName: "FK_activity_instance_participant_instance_id",
    })
    @ManyToOne(
        () => ActivityInstance,
        (instance) => instance.participants,
        { onDelete: "CASCADE" },
    )
    instance: ActivityInstance;

    @PrimaryColumn({ type: "int8" })
    @Index("IDX_activity_instance_participants_user_id")
    user_id: string;

    @JoinColumn({
        name: "user_id",
        foreignKeyConstraintName: "FK_activity_instance_participant_user_id",
    })
    @ManyToOne(() => User, { onDelete: "CASCADE" })
    user: User;

    @Column()
    session_id: string;

    @Column({ type: "varchar", nullable: true })
    nonce?: string | null;

    @Column({ type: "timestamp with time zone", default: () => "now()" })
    joined_at: Date;
}
