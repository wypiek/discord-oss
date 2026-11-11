import type { Activity } from "@spacebar/util";
import { ActivityCredit, creditActivity, gameKey } from "@spacebar/util/util/ActivityBadges";

export const GAME_SAMPLE_MS = 60_000;

export type SampledSocket = { readyState: number; user_id?: string; session?: { activities?: Activity[] } | null };

export function gameCredits(sockets: Iterable<SampledSocket>, seconds: number): ActivityCredit[] {
    const credits: ActivityCredit[] = [];
    for (const socket of sockets) {
        if (socket.readyState !== 1 || !socket.user_id) continue;
        const games = (socket.session?.activities ?? []).map(gameKey).filter((key): key is string => key !== null);
        if (games.length) credits.push({ user_id: socket.user_id, game_seconds: seconds, games });
    }
    return credits;
}

let timer: ReturnType<typeof setInterval> | undefined;

export function startGameTimeSampler(sockets: () => Iterable<SampledSocket>) {
    timer ??= setInterval(() => {
        creditActivity(gameCredits(sockets(), GAME_SAMPLE_MS / 1000)).catch((error) => console.warn("[Badges] Could not record game time:", (error as Error).message));
    }, GAME_SAMPLE_MS).unref();
}

export function stopGameTimeSampler() {
    clearInterval(timer);
    timer = undefined;
}
