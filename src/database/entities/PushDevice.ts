import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseClass } from "./BaseClass";
import { Session } from "./Session";
import { User } from "./User";

export interface WebPushKeys {
    p256dh: string;
    auth: string;
}

@Entity({
    name: "push_devices",
})
@Index("UQ_push_devices_provider_token_user", ["provider", "token", "user_id"], { unique: true })
export class PushDevice extends BaseClass {
    @Column({ type: "int8" })
    @Index("IDX_push_devices_user_id")
    user_id: string;

    @JoinColumn({ name: "user_id", foreignKeyConstraintName: "FK_push_device_user_id" })
    @ManyToOne(() => User, { onDelete: "CASCADE" })
    user: User;

    @Column({ type: String, nullable: true })
    session_id: string | null;

    @JoinColumn({ name: "session_id", foreignKeyConstraintName: "FK_push_device_session_id" })
    @ManyToOne(() => Session, { onDelete: "CASCADE" })
    session: Session;

    @Column()
    provider: string;

    @Column({ type: "text" })
    token: string;

    @Column({ type: "jsonb", nullable: true })
    keys: WebPushKeys | null;

    @Column({ type: String, nullable: true })
    voip_provider: string | null;

    @Column({ type: "text", nullable: true })
    voip_token: string | null;

    @CreateDateColumn()
    created_at: Date;
}
