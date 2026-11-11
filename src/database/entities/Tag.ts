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
    emoji_id?: string | null;

    @Column({ nullable: true, type: "varchar" })
    emoji_name?: string | null;

    @Column({ type: "int", default: 0 })
    position: number = 0;

    assignInput(input: { name: string; moderated?: boolean | null; emoji_id?: string | null; emoji_name?: string | null }) {
        this.name = input.name.slice(0, 20);
        this.moderated = !!input.moderated;
        this.emoji_id = input.emoji_id || null;
        this.emoji_name = input.emoji_id ? null : input.emoji_name || null;
        return this;
    }

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
