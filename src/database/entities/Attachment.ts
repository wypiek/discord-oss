import { Column, Entity, JoinColumn, ManyToOne, Index } from "typeorm";
import { Config } from "@spacebar/util/util";
import { getUrlSignature, NewUrlUserSignatureData, NewUrlSignatureData } from "@spacebar/util/Signing";
import { AttachmentFlags, PublicAttachment } from "@spacebar/schemas/api/messages/Attachments";
import { BaseClass } from "./BaseClass";

@Entity({
    name: "attachments",
})
export class Attachment extends BaseClass {
    @Column()
    filename: string; // name of file attached

    @Column()
    size: number; // size of file in bytes

    @Column({ nullable: true })
    height?: number; // height of file (if image)

    @Column({ nullable: true })
    width?: number; // width of file (if image)

    @Column({ nullable: true })
    content_type?: string;

    @Column({ nullable: true, foreignKeyConstraintName: "FK_attachment_message_id" })
    @Index("IDX_attachments_message_id")
    message_id: string;

    @Column({ nullable: true, foreignKeyConstraintName: "FK_attachment_channel_id" })
    channel_id: string;

    @JoinColumn({ name: "message_id", foreignKeyConstraintName: "FK_attachment_message_id" })
    @ManyToOne(
        () => require("./Message").Message,
        (message: import("./Message").Message) => message.attachments,
        {
            onDelete: "CASCADE",
        },
    )
    message: import("./Message").Message;

    @JoinColumn({ name: "channel_id", foreignKeyConstraintName: "FK_attachment_channel_id" })
    @ManyToOne(() => require("./Channel").Channel, {
        onDelete: "CASCADE",
    })
    channel: import("./Channel").Channel;

    @Column({ nullable: true, type: "character varying" })
    description?: string;

    @Column({ nullable: true, type: "int2" })
    flags?: AttachmentFlags;

    @Column({ nullable: true, type: "int2" })
    content_scan_version?: number;

    @Column({ nullable: true, type: "int2" })
    placeholder_version?: number;

    @Column({ nullable: true, type: "character varying" })
    placeholder?: string;

    @Column({ nullable: true, type: "float8" })
    duration_secs?: number;

    @Column({ nullable: true, type: "character varying" })
    waveform?: string;

    @Column({ nullable: true, type: "character varying" })
    title?: string;

    @Column({ nullable: true, type: "timestamp with time zone" })
    clip_created_at?: Date;

    toJSON(): PublicAttachment {
        const channelId = this.channel_id ?? this.channel?.id ?? this.message?.channel_id;
        const messageId = this.message_id ?? this.message?.id;
        const cdn = Config.get().cdn.endpointPublic?.replace(/\/+$/, "");
        return {
            ...this,
            url: `${cdn}/attachments/${channelId}/${this.id}/${this.filename}`,
            proxy_url: `${cdn}/attachments/${channelId}/${this.id}/${this.filename}`,
        } satisfies PublicAttachment;
    }
    signUrls(data: NewUrlUserSignatureData): PublicAttachment {
        const att = Attachment.prototype.toJSON.apply(this);
        return {
            ...att,
            url: getUrlSignature(new NewUrlSignatureData({ ...data, url: att.url }))
                .applyToUrl(att.url)
                .toString(),
            proxy_url: att.proxy_url
                ? getUrlSignature(new NewUrlSignatureData({ ...data, url: att.proxy_url }))
                      .applyToUrl(att.proxy_url)
                      .toString()
                : att.proxy_url,
        };
    }
}
