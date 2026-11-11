export interface VoiceHealthSnapshot {
    enabled: boolean;
    library: string | null;
    reason?: string;
    started_at?: string;
    listen?: string;
    sfu?: {
        connected: boolean;
        socket: string;
        managed: boolean;
        pid: number | null;
        restarts: number;
        last_exit_code: number | null;
        last_exit_at: string | null;
        ping_ms: number | null;
        ping_error: string | null;
        public_ip: string;
        udp_port: number;
    };
    rooms?: number;
    clients?: number;
    connected_clients?: number;
    dave_sessions?: number;
}

let provider: (() => Promise<VoiceHealthSnapshot>) | null = null;

export const VoiceHealth = {
    register(fn: () => Promise<VoiceHealthSnapshot>) {
        provider = fn;
    },
    async snapshot(): Promise<VoiceHealthSnapshot | null> {
        return provider ? provider() : null;
    },
};
