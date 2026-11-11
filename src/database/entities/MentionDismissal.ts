import { BaseEntity, Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { Message } from "./Message";
import { User } from "./User";

@Entity({
    name: "mention_dismissals",
})
export class MentionDismissal extends BaseEntity {
    @PrimaryColumn({ type: "int8" })
    user_id: string;

    @PrimaryColumn({ type: "int8" })
    message_id: string;

    @JoinColumn({ name: "user_id", foreignKeyConstraintName: "FK_mention_dismissal_user_id" })
    @ManyToOne(() => User, { onDelete: "CASCADE" })
    user: User;

    @JoinColumn({ name: "message_id", foreignKeyConstraintName: "FK_mention_dismissal_message_id" })
    @ManyToOne(() => Message, { onDelete: "CASCADE" })
    message: Message;
}
