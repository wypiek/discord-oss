// FIXME: better naming
export interface GenerateWebAuthnCredentialsSchema {
    password: string;
}

// FIXME: better naming
export interface CreateWebAuthnCredentialSchema {
    credential: string;
    name: string;
    ticket: string;
}

export type WebAuthnPostSchema = GenerateWebAuthnCredentialsSchema | CreateWebAuthnCredentialSchema;

export interface WebAuthnTotpSchema {
    code: string;
    ticket: string;
}
