export const NATIVE_VOICE_MODES = ["aead_aes256_gcm_rtpsize", "aead_xchacha20_poly1305_rtpsize"] as const;

export type NativeVoiceMode = (typeof NATIVE_VOICE_MODES)[number];

export const nativeVoiceEnabled = () => process.env.NATIVE_VOICE === "true" && !!(process.env.PION_SFU_BIN || process.env.PION_SFU_IPC);

export const isNativeVoiceMode = (mode: unknown): mode is NativeVoiceMode => typeof mode === "string" && (NATIVE_VOICE_MODES as readonly string[]).includes(mode);
