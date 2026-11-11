import { BackupCode, UserSettingsSchema } from "@spacebar/schemas";

export interface TokenResponse {
    token: string;
    settings: UserSettingsSchema;
}

export interface TokenOnlyResponse {
    token: string;
}

export interface TokenWithBackupCodesResponse {
    token: string;
    backup_codes: BackupCode[];
}
