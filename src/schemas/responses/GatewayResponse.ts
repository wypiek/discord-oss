export interface GatewayResponse {
    url: string;
}

export interface GatewayBotResponse extends GatewayResponse {
    shards: number;
    session_start_limit: {
        total: number;
        remaining: number;
        reset_after: number;
        max_concurrency: number;
    };
}
