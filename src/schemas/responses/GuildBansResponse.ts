export type GuildBansResponse = GuildBanResponse[];

export interface GuildBanResponse {
    reason: string | null;
    user: {
        username: string;
        discriminator: string;
        global_name?: string | null;
        id: string;
        avatar: string | null;
        public_flags: number;
    };
}
