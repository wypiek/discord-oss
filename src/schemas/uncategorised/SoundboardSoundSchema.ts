import { float } from "@spacebar/schemas";

export interface SoundboardSoundCreateSchema {
    /**
     * @minLength 2
     * @maxLength 32
     */
    name: string;
    sound: string;
    /**
     * @minimum 0
     * @maximum 1
     */
    volume?: float;
    /**
     * @maxLength 20
     */
    emoji_id?: string | null;
    /**
     * @maxLength 32
     */
    emoji_name?: string | null;
}

export interface SoundboardSoundModifySchema {
    /**
     * @minLength 2
     * @maxLength 32
     */
    name?: string;
    /**
     * @minimum 0
     * @maximum 1
     */
    volume?: float;
    /**
     * @maxLength 20
     */
    emoji_id?: string | null;
    /**
     * @maxLength 32
     */
    emoji_name?: string | null;
}

export interface SendSoundboardSoundSchema {
    /**
     * @maxLength 20
     */
    sound_id: string;
    /**
     * @maxLength 20
     */
    source_guild_id?: string | null;
    /**
     * @maxLength 20
     */
    emoji_id?: string | null;
    /**
     * @maxLength 32
     */
    emoji_name?: string | null;
}
