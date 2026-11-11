import { Column, Entity, JoinColumn, ManyToOne, Index } from "typeorm";
import { BaseClass } from "./BaseClass";
import { Channel } from "./Channel";
import { Guild } from "./Guild";
import { Member } from "./Member";
import { User } from "./User";
import { PublicVoiceState, PublicVoiceStateProjection } from "@spacebar/schemas";

//https://gist.github.com/vassjozsef/e482c65df6ee1facaace8b3c9ff66145#file-voice_state-ex
@Entity({
    name: "voice_states",
})
export class VoiceState extends BaseClass {
    @Column({ nullable: true })
    @Index("IDX_voice_states_guild_id")
    guild_id: string;

    @JoinColumn({ name: "guild_id", foreignKeyConstraintName: "FK_voice_state_guild_id" })
    @ManyToOne(
        () => Guild,
        (guild) => guild.voice_states,
        {
            onDelete: "CASCADE",
        },
    )
    guild?: Guild;

    @Column({ nullable: true })
    @Index("IDX_voice_states_channel_id")
    channel_id: string;

    @JoinColumn({ name: "channel_id", foreignKeyConstraintName: "FK_voice_state_channel_id" })
    @ManyToOne(() => Channel, {
        onDelete: "CASCADE",
    })
    channel: Channel;

    @Column({ nullable: true })
    @Index("IDX_voice_states_user_id")
    user_id: string;

    @JoinColumn({ name: "user_id", foreignKeyConstraintName: "FK_voice_state_user_id" })
    @ManyToOne(() => User, {
        onDelete: "CASCADE",
    })
    user: User;

    // @JoinColumn([{ name: "user_id", referencedColumnName: "id" },{ name: "guild_id", referencedColumnName: "guild_id" }])
    // @ManyToOne(() => Member, {
    // 	onDelete: "CASCADE",
    // })
    //TODO find a way to make it work without breaking Guild.voice_states
    member: Member;

    @Column()
    session_id: string;

    @Column({ nullable: true })
    token: string;

    @Column()
    deaf: boolean;

    @Column()
    mute: boolean;

    @Column()
    self_deaf: boolean;

    @Column()
    self_mute: boolean;

    @Column({ nullable: true })
    self_stream?: boolean;

    @Column()
    self_video: boolean;

    @Column()
    suppress: boolean; // whether this user is muted by the current user

    @Column({ nullable: true, default: null })
    request_to_speak_timestamp?: Date;

    @Column({
        type: "bigint",
        nullable: true,
        transformer: {
            to: (value?: number | null) => value,
            from: (value?: string | null) => (value == null ? value : Number(value)),
        },
    })
    connected_at?: number | null;

    toPublicVoiceState() {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const voiceState: any = {};
        PublicVoiceStateProjection.forEach((x) => {
            voiceState[x] = this[x];
        });
        return voiceState as PublicVoiceState;
    }
}
