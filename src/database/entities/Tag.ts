import { Column, Entity, JoinColumn, ManyToOne, Index } from "typeorm";
import { BaseClass } from "./BaseClass";
import { Channel } from "./Channel";

@Entity({
    name: "tags",
})
export class Tag extends BaseClass {
    @Column({ type: "int8" })
    @Index("IDX_tags_channel_id")
    channel_id: string;

    @JoinColumn({ name: "channel_id", foreignKeyConstraintName: "FK_tag_channel_id" })
    @ManyToOne(
        () => Channel,
        (channel) => channel.available_tags,
        {
            onDelete: "CASCADE",
        },
    )
    channel: Channel;

    @Column()
    name: string;

    @Column()
    moderated: boolean = false;

    @Column({ nullable: true, type: "int8" })
    emoji_id?: string;

    @Column({ nullable: true })
    emoji_name?: string;

    @Column({ type: "int", default: 0 })
    position: number = 0;

    toJSON() {
        return {
            name: this.name,
            id: this.id,
            moderated: this.moderated,
            emoji_id: this.emoji_id ?? null,
            emoji_name: this.emoji_name ?? null,
        };
    }
}
