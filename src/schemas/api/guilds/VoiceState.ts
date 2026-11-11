//TODO: remove entity import
import { VoiceState } from "@spacebar/database";

export enum PublicVoiceStateEnum {
    user_id,
    suppress,
    session_id,
    self_video,
    self_mute,
    self_deaf,
    self_stream,
    request_to_speak_timestamp,
    mute,
    deaf,
    channel_id,
    guild_id,
    connected_at,
}

export type PublicVoiceStateKeys = keyof typeof PublicVoiceStateEnum;

export const PublicVoiceStateProjection = Object.values(PublicVoiceStateEnum).filter((x) => typeof x === "string") as PublicVoiceStateKeys[];

export type PublicVoiceState = Pick<VoiceState, PublicVoiceStateKeys>;
