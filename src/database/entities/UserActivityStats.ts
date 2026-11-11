import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { BaseClassWithoutId } from "./BaseClass";
import { User } from "./User";

@Entity({
    name: "user_activity_stats",
})
export class UserActivityStats extends BaseClassWithoutId {
    @PrimaryColumn({ type: "int8" })
    user_id: string;

    @JoinColumn({ name: "user_id", foreignKeyConstraintName: "FK_user_activity_stats_user_id" })
    @ManyToOne(() => User, { onDelete: "CASCADE" })
    user: User;

    @Column({ type: "bigint", default: 0 })
    game_seconds: string = "0";

    @Column({ type: "bigint", default: 0 })
    stream_seconds: string = "0";

    @Column({ type: "jsonb", default: [] })
    games: string[] = [];

    @Column({ type: "jsonb", default: {} })
    tier_unlocks: Record<string, Record<string, string>> = {};

    @Column({ type: "timestamptz", default: () => "now()" })
    updated_at: Date = new Date();
}
