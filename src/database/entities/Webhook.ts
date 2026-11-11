import { Column, Entity, JoinColumn, ManyToOne, Index } from "typeorm";
import { Application } from "./Application";
import { BaseClass } from "./BaseClass";
import { Channel } from "./Channel";
import { Guild } from "./Guild";
import { User } from "./User";
import { PublicMessageWebhook, WebhookType } from "@spacebar/schemas";

@Entity({
    name: "webhooks",
})
export class Webhook extends BaseClass {
    @Column({ type: "int" })
    type: WebhookType;

    @Column({ nullable: true })
    name: string;

    @Column({ nullable: true })
    avatar: string;

    @Column({ nullable: true })
    token?: string;

    @Column({ nullable: true })
    @Index("IDX_webhooks_guild_id")
    guild_id?: string;

    @JoinColumn({ name: "guild_id", foreignKeyConstraintName: "FK_webhook_guild_id" })
    @ManyToOne(() => Guild, {
        onDelete: "CASCADE",
    })
    guild?: Guild;

    @Column({ nullable: true })
    @Index("IDX_webhooks_channel_id")
    channel_id: string;

    @JoinColumn({ name: "channel_id", foreignKeyConstraintName: "FK_webhook_channel_id" })
    @ManyToOne(() => Channel, {
        onDelete: "CASCADE",
    })
    channel: Channel;

    @Column({ nullable: true })
    application_id: string;

    @JoinColumn({ name: "application_id", foreignKeyConstraintName: "FK_webhook_application_id" })
    @ManyToOne(() => Application, {
        onDelete: "CASCADE",
    })
    application: Application;

    @Column({ nullable: true })
    user_id: string;

    @JoinColumn({ name: "user_id", foreignKeyConstraintName: "FK_webhook_user_id" })
    @ManyToOne(() => User, {
        onDelete: "CASCADE",
    })
    user: User;

    @Column({ nullable: true })
    source_guild_id?: string;

    @JoinColumn({ name: "source_guild_id", foreignKeyConstraintName: "FK_webhook_source_guild_id" })
    @ManyToOne(() => Guild, {
        onDelete: "CASCADE",
    })
    source_guild?: Guild;

    @Column({ nullable: true })
    source_channel_id: string;

    @JoinColumn({
        name: "source_channel_id",
        foreignKeyConstraintName: "FK_webhook_source_channel_id",
    })
    @ManyToOne(() => Channel, {
        onDelete: "CASCADE",
    })
    source_channel: Channel;

    url: string;

    public toMessageWebhook(): PublicMessageWebhook {
        return {
            type: this.type,
            name: this.name,
            avatar: this.avatar,
            user_id: this.user_id,
            application_id: this.application_id,
            source_guild_id: this.source_guild_id,
            source_channel_id: this.source_channel_id,
        };
    }
}
