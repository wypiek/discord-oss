import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { BaseClassWithoutId } from "./BaseClass";
import { Announcement } from "./Announcement";

// one dm an announcement was delivered as, so deleting the announcement can take the messages back
@Entity({
    name: "announcement_messages",
})
export class AnnouncementMessage extends BaseClassWithoutId {
    @PrimaryColumn({ type: "int8", foreignKeyConstraintName: "FK_announcement_messages_message_id" })
    message_id: string;

    @Column({ type: "int8" })
    channel_id: string;

    @Column({ type: "int8", foreignKeyConstraintName: "FK_announcement_messages_announcement_id" })
    @Index("IDX_announcement_messages_announcement_id")
    announcement_id: string;

    @JoinColumn({
        name: "message_id",
        foreignKeyConstraintName: "FK_announcement_messages_message_id",
    })
    @ManyToOne(() => require("./Message").Message, { onDelete: "CASCADE" })
    message: import("./Message").Message;

    @JoinColumn({
        name: "announcement_id",
        foreignKeyConstraintName: "FK_announcement_messages_announcement_id",
    })
    @ManyToOne(() => Announcement, { onDelete: "CASCADE" })
    announcement: Announcement;
}
