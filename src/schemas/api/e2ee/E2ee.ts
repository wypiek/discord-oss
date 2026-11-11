export interface E2eeEnvelopeKey {
    user_id: string;
    device_id: string;
    prekey_id: number;
    enc: string;
    wrapped: string;
}

export interface E2eeEnvelope {
    v: number;
    alg: string;
    sender_device: string;
    mid?: string;
    iv: string;
    ct: string;
    keys: E2eeEnvelopeKey[];
    backup?: E2eeEnvelopeBackupKey[];
    mentions?: string[];
    sig: string;
}

export interface E2eeEnvelopeBackupKey {
    user_id: string;
    enc: string;
    wrapped: string;
}

export interface E2eePrekeySchema {
    id: number;
    /**
     * @maxLength 256
     */
    public_key: string;
    /**
     * @maxLength 256
     */
    signature: string;
}

export interface E2eeDeviceSignature {
    /**
     * @maxLength 64
     */
    device_id: string;
    /**
     * @maxLength 256
     */
    identity_signature: string;
}

export interface E2eeIdentityUpdateSchema {
    /**
     * @maxLength 256
     */
    public_key: string;
    /**
     * @maxLength 256
     */
    previous_signature?: string;
    /**
     * @maxItems 64
     */
    devices?: E2eeDeviceSignature[];
}

export type E2eeBackupMode = "password" | "recovery";

export interface E2eeBackupKdf {
    name: "argon2id" | "hkdf-sha256";
    memory?: number;
    iterations?: number;
    parallelism?: number;
}

export interface E2eeBackupSecretSchema {
    version: number;
    mode: E2eeBackupMode;
    kdf: E2eeBackupKdf;
    /**
     * @maxLength 256
     */
    salt: string;
    /**
     * @maxLength 256
     */
    wrapped_secret: string | null;
}

export interface E2eeBackupSchema extends E2eeBackupSecretSchema {
    /**
     * @maxLength 256
     */
    identity_key: string;
    /**
     * @maxLength 1024
     */
    wrapped_identity: string;
    /**
     * @maxLength 256
     */
    backup_public_key: string;
    /**
     * @maxLength 256
     */
    backup_key_signature: string;
    /**
     * @maxLength 1024
     */
    wrapped_backup_key: string;
}

export interface E2eeTrustSchema {
    version: number;
    /**
     * @maxLength 65536
     */
    data: string;
}

export interface E2eeTrustResponse {
    version: number;
    data: string | null;
}

export interface E2eeBackupResponse extends E2eeBackupSchema {
    updated_at: string;
    trust: E2eeTrustResponse;
}

export interface E2eeBackupKeyEntry {
    /**
     * @maxLength 64
     */
    message_id: string;
    /**
     * @maxLength 256
     */
    enc: string;
    /**
     * @maxLength 256
     */
    wrapped: string;
}

export interface E2eeBackupKeysUploadSchema {
    /**
     * @maxItems 100
     */
    keys: E2eeBackupKeyEntry[];
}

export interface E2eeBackupKeysQuerySchema {
    /**
     * @maxItems 100
     * @items.type string
     * @items.maxLength 64
     */
    message_ids: string[];
}

export interface E2eeBackupKeysResponse {
    keys: E2eeBackupKeyEntry[];
}

export type E2eeLinkStage = "request" | "offer" | "reveal" | "approve" | "deny" | "cancel" | "invite";

export interface E2eeLinkSchema {
    /**
     * @maxLength 64
     */
    request_id: string;
    stage: E2eeLinkStage;
    /**
     * @maxLength 64
     */
    device_id: string;
    /**
     * @maxLength 64
     */
    to_device?: string;
    /**
     * @maxLength 64
     */
    name?: string;
    /**
     * @maxLength 256
     */
    commit?: string;
    /**
     * @maxLength 256
     */
    public_key?: string;
    /**
     * @maxLength 256
     */
    iv?: string;
    /**
     * @maxLength 256
     */
    ct?: string;
}

export interface E2eeSignedKey {
    public_key: string;
    signature: string;
}

export interface E2eeDeviceCreateSchema {
    /**
     * @maxLength 64
     */
    device_id: string;
    /**
     * @maxLength 256
     */
    signing_key: string;
    /**
     * @maxLength 256
     */
    identity_signature?: string;
    /**
     * @maxLength 64
     */
    name?: string;
    prekey: E2eePrekeySchema;
}

export interface E2eeKeysQuerySchema {
    /**
     * @TJS-type array
     * @maxItems 100
     * @items.type string
     * @items.maxLength 64
     */
    user_ids?: string[];
    /**
     * @maxLength 64
     */
    channel_id?: string;
}

export interface ChannelE2eeUpdateSchema {
    enabled: boolean;
}

export type E2eeDeviceStatus = "active" | "pending" | "revoked";

export interface E2eeDeviceResponse {
    device_id: string;
    signing_key: string;
    identity_signature: string | null;
    status: E2eeDeviceStatus;
    name: string | null;
    prekey: E2eePrekeySchema;
    created_at: string;
    revoked_at?: string | null;
    session?: E2eeDeviceSession | null;
}

export interface E2eeDeviceSession {
    signed_in: boolean;
    last_seen: string | null;
    os: string | null;
    browser: string | null;
    location: string | null;
}

export interface E2eePasswordSchema {
    /**
     * @maxLength 256
     */
    password: string;
}

export interface E2eeResetSchema {
    /**
     * @maxLength 256
     */
    password: string;
    /**
     * @maxLength 256
     */
    public_key: string;
}

export interface E2eeUserKeysResponse {
    identity_key: string | null;
    identity_created_at?: string | null;
    previous_identity?: E2eeSignedKey | null;
    backup_key?: E2eeSignedKey | null;
    devices: E2eeDeviceResponse[];
}

export interface E2eeKeysQueryResponse {
    users: { [user_id: string]: E2eeUserKeysResponse };
    channel_members?: string[];
}

export interface E2eeStateResponse {
    private_by_default: boolean;
    identity_key: string | null;
    identity_created_at?: string | null;
    previous_identity?: E2eeSignedKey | null;
    backup_key?: E2eeSignedKey | null;
    devices: E2eeDeviceResponse[];
    channels: string[];
}

export interface ChannelE2eeResponse {
    channel_id: string;
    enabled: boolean;
    enabled_at: string | null;
}

export interface E2eeRecoverySchema {
    /**
     * @maxLength 256
     */
    identity_key: string;
    backup_version: number;
    /**
     * @maxLength 64
     */
    device_id: string;
    /**
     * @maxLength 256
     */
    backup_secret: string;
    /**
     * @maxLength 256
     */
    signature: string;
}

export interface E2eeRecoveryResponse {
    backup_secret: string;
}

export interface E2eeRecoveryStatusResponse {
    ready: boolean;
    identity_key?: string;
    backup_public_key?: string;
    backup_version?: number;
}
