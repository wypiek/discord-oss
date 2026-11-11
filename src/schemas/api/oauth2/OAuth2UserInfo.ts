export interface OAuth2UserInfoResponse {
    sub: string;
    email: string | null;
    email_verified: boolean;
    preferred_username: string;
    nickname: string | null;
    picture: string;
    locale: string;
}
