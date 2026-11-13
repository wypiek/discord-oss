export type MusicSource = "spotify" | "soundcloud";

export interface MusicTrack {
    source: MusicSource;
    title: string;
    artist: string;
    album?: string;
    artworkUrl?: string;
    url?: string;
    duration?: number;
    position?: number;
    paused: boolean;
    updatedAt: number;
}

export interface MusicWatch {
    spotify?: boolean;
    soundcloud?: boolean;
}
