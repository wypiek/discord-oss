import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseClass } from "./BaseClass";
import { Channel } from "./Channel";
import { Guild } from "./Guild";

@Entity({ name: "stage_instances" })
export class StageInstance extends BaseClass {
    @Column({ type: "int8" })
    @Index("IDX_stage_instances_guild_id")
    guild_id: string;

    @JoinColumn({ name: "guild_id", foreignKeyConstraintName: "FK_stage_instance_guild_id" })
    @ManyToOne(() => Guild, { onDelete: "CASCADE" })
    guild: Guild;

    @Column({ type: "int8", unique: true })
    channel_id: string;

    @JoinColumn({ name: "channel_id", foreignKeyConstraintName: "FK_stage_instance_channel_id" })
    @ManyToOne(() => Channel, { onDelete: "CASCADE" })
    channel: Channel;

    @Column()
    topic: string;

    @Column({ type: "int", default: 2 })
    privacy_level: number;

    @Column({ type: "int8", nullable: true })
    guild_scheduled_event_id?: string | null;

    toJSON() {
        return {
            id: this.id,
            guild_id: this.guild_id,
            channel_id: this.channel_id,
            topic: this.topic,
            privacy_level: this.privacy_level,
            discoverable_disabled: true,
            guild_scheduled_event_id: this.guild_scheduled_event_id ?? null,
            invite_code: null,
        };
    }
}
