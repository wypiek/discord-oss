import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseClass } from "./BaseClass";
import { User } from "./User";
import { Channel } from "./Channel";

export enum ScheduledMessageState {
    SCHEDULED = 0,
    ERROR_SCHEDULED_MESSAGES_DISABLED = 1,
    ERROR_USER_NOT_FOUND = 2,
    ERROR_USER_CANNOT_USE_SCHEDULED_MESSAGES = 3,
    ERROR_CHANNEL_NOT_FOUND = 4,
    ERROR_SEND_FAILED = 5,
}

export interface ScheduledMessagePayload {
    content?: string;
    flags?: number;
    message_reference?: {
        message_id: string;
        channel_id?: string;
        guild_id?: string;
        type?: number;
        fail_if_not_exists?: boolean;
    };
    allowed_mentions?: {
        parse?: string[];
        users?: string[];
        roles?: string[];
        replied_user?: boolean;
    };
    sticker_ids?: string[];
    poll?: object;
    attachments?: {
        id?: string;
        filename: string;
        uploaded_filename: string;
        description?: string;
        title?: string;
        is_spoiler?: boolean;
        duration_secs?: number;
        waveform?: string;
    }[];
}

@Entity({
    name: "scheduled_messages",
})
@Index("IDX_scheduled_message_due", ["state", "send_at"])
export class ScheduledMessage extends BaseClass {
    @Index("IDX_scheduled_message_user_id")
    @Column()
    user_id: string;

    @JoinColumn({ name: "user_id", foreignKeyConstraintName: "FK_scheduled_message_user_id" })
    @ManyToOne(() => User, { onDelete: "CASCADE" })
    user: User;

    @Column()
    channel_id: string;

    @JoinColumn({ name: "channel_id", foreignKeyConstraintName: "FK_scheduled_message_channel_id" })
    @ManyToOne(() => Channel, { onDelete: "CASCADE" })
    channel: Channel;

    @Column({ type: "timestamp with time zone" })
    send_at: Date;

    @Column({ type: "jsonb" })
    payload: ScheduledMessagePayload;

    @Column({ type: "int2", default: ScheduledMessageState.SCHEDULED })
    state: ScheduledMessageState;

    @Column({ type: "uuid", nullable: true, select: false })
    claim_token: string | null;

    @Column({ type: "timestamp with time zone", nullable: true, select: false })
    claim_until: Date | null;

    @Column({ type: "bigint", nullable: true, select: false })
    message_id: string | null;
}
