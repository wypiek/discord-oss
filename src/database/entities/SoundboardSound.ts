import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseClass } from "./BaseClass";
import { Guild } from "./Guild";
import { User } from "./User";

@Entity({
    name: "soundboard_sounds",
})
export class SoundboardSound extends BaseClass {
    @Index()
    @Column({ type: "int8" })
    guild_id: string;

    @JoinColumn({ name: "guild_id", foreignKeyConstraintName: "FK_soundboard_sound_guild_id" })
    @ManyToOne(() => Guild, { onDelete: "CASCADE" })
    guild: Guild;

    @Column()
    name: string;

    @Column({ type: "double precision", default: 1 })
    volume: number;

    @Column({ type: "int8", nullable: true })
    emoji_id: string | null;

    @Column({ type: "varchar", nullable: true })
    emoji_name: string | null;

    @Column({ type: "int8", nullable: true })
    user_id: string | null;

    @JoinColumn({ name: "user_id", foreignKeyConstraintName: "FK_soundboard_sound_user_id" })
    @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
    user?: User | null;

    @Column({ default: true })
    available: boolean;

    toJSON() {
        return {
            sound_id: this.id,
            name: this.name,
            volume: this.volume,
            emoji_id: this.emoji_id ?? null,
            emoji_name: this.emoji_name ?? null,
            guild_id: this.guild_id,
            available: this.available,
            user_id: this.user_id ?? undefined,
            user: this.user?.toPublicUser?.() ?? undefined,
        };
    }
}
