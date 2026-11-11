import { Column, Entity, JoinColumn, ManyToOne, Index } from "typeorm";
import { BaseClass } from "./BaseClass";
import { Guild } from "./Guild";
import { User } from "./User";

@Entity({
    name: "bans",
})
@Index("IDX_bans_guild_user", ["guild_id", "user_id"])
export class Ban extends BaseClass {
    @Column({ nullable: true })
    user_id: string;

    @JoinColumn({ name: "user_id", foreignKeyConstraintName: "FK_ban_user_id" })
    @ManyToOne(() => User, {
        onDelete: "CASCADE",
    })
    user: User;

    @Column({ nullable: true })
    guild_id: string;

    @JoinColumn({ name: "guild_id", foreignKeyConstraintName: "FK_ban_guild_id" })
    @ManyToOne(() => Guild, {
        onDelete: "CASCADE",
    })
    guild: Guild;

    @Column({ nullable: true })
    executor_id: string;

    @JoinColumn({ name: "executor_id", foreignKeyConstraintName: "FK_ban_executor_id" })
    @ManyToOne(() => User)
    executor: User;

    @Column({ nullable: true })
    ip?: string;

    @Column({ nullable: true })
    reason?: string;
}
