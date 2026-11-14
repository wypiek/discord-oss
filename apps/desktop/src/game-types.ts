export type GamePlatform = "darwin" | "win32" | "linux";

export interface DetectableExecutable {
    name: string;
    os?: string;
    arguments?: string;
    is_launcher?: boolean;
}

export interface DetectableEntry {
    id: string;
    name: string;
    aliases?: string[];
    executables?: DetectableExecutable[];
}

export interface GameOverride {
    exePath: string;
    name: string;
    id?: string;
}

export interface RunningProcess {
    pid: number;
    path: string;
    cmdLine?: string;
    windowed?: boolean;
}

export interface DetectedGame {
    pid: number;
    id?: string;
    name: string;
    exePath: string;
    exeName: string;
    cmdLine: string;
}

export interface GamesUpdate {
    games: DetectedGame[];
    candidates: DetectedGame[];
}

export interface GamesWatch {
    overrides?: GameOverride[];
    candidates?: boolean;
}
