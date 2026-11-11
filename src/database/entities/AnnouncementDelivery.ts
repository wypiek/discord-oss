import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { BaseClassWithoutId } from "./BaseClass";
import { Announcement } from "./Announcement";
import { User } from "./User";

@Entity({ name: "announcement_deliveries" })
@Index("IDX_announcement_deliveries_ready", ["status", "next_retry_at"])
export class AnnouncementDelivery extends BaseClassWithoutId {
    @PrimaryColumn({ type: "int8" }) announcement_id: string;
    @PrimaryColumn({ type: "int8" }) user_id: string;
    @JoinColumn({
        name: "announcement_id",
        foreignKeyConstraintName: "FK_announcement_deliveries_announcement",
    })
    @ManyToOne(() => Announcement, { onDelete: "CASCADE" })
    announcement: Announcement;
    @JoinColumn({ name: "user_id", foreignKeyConstraintName: "FK_announcement_deliveries_user" })
    @ManyToOne(() => User, { onDelete: "CASCADE" })
    user: User;
    @Column({ type: "varchar", default: "queued" }) status: "queued" | "delivering" | "delivered" | "failed";
    @Column({ type: "int", default: 0 }) attempts: number;
    @Column({ type: "timestamptz", default: () => "now()" }) next_retry_at: Date;
    @Column({ type: "varchar", nullable: true }) last_error: string | null;
    @Column({ type: "varchar", nullable: true }) lease_token: string | null;
    @Column({ type: "int8", nullable: true }) message_id: string | null;
}
