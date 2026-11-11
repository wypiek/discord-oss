export interface BackupCodesChallengeResponse {
    nonce: string;
    regenerate_nonce: string;
}

export interface BackupCode {
    code: string;
    consumed: boolean;
}

export type BackupCodeArray = BackupCode[];
