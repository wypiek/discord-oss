import { getDatabase } from "@spacebar/database";
import { sqlZipArrays } from "@spacebar/database/Sql";

const DAY = 86_400_000;
export const GAME_PLAY_KEEP_DAYS = 16;
export const MAX_GAME_KEY_LENGTH = 255;

export const playDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export type GamePlayCredit = { user_id: string; game_seconds: number; games: string[] };

export type GamePlayRow = { user_id: string; day: string; game: string; seconds: number; last_played_at: Date };

let prunedDay = "";

export function gamePlayRows(credits: GamePlayCredit[]) {
    return credits.flatMap((credit) =>
        credit.game_seconds > 0
            ? [...new Set(credit.games)].map((game) => ({ user_id: credit.user_id, game: game.slice(0, MAX_GAME_KEY_LENGTH), seconds: Math.round(credit.game_seconds) }))
            : [],
    );
}

export async function recordGamePlay(credits: GamePlayCredit[], at = new Date()) {
    const rows = gamePlayRows(credits);
    if (!rows.length) return 0;
    const day = playDay(at.getTime());
    const db = getDatabase()!;
    await db.query(
        `INSERT INTO "game_play_days" ("user_id", "day", "game", "seconds", "last_played_at")
        SELECT "user_id", $4, "game", "seconds", $5 FROM ${sqlZipArrays([
            { parameter: "$1", type: "bigint", name: "user_id" },
            { parameter: "$2", type: "varchar", name: "game" },
            { parameter: "$3", type: "int", name: "seconds" },
        ])} WHERE true
        ON CONFLICT ("user_id", "day", "game") DO UPDATE SET "seconds" = "game_play_days"."seconds" + EXCLUDED."seconds", "last_played_at" = EXCLUDED."last_played_at"`,
        [rows.map((row) => row.user_id), rows.map((row) => row.game), rows.map((row) => row.seconds), day, at],
    );
    if (prunedDay !== day) {
        prunedDay = day;
        await db.query(`DELETE FROM "game_play_days" WHERE "day" < $1`, [playDay(at.getTime() - GAME_PLAY_KEEP_DAYS * DAY)]);
    }
    return rows.length;
}

export async function gamePlayForGuild(guildId: string, fromDay: string, toDay: string): Promise<GamePlayRow[]> {
    const rows: { user_id: string | number; day: string; game: string; seconds: string | number; last_played_at: string | Date }[] = await getDatabase()!.query(
        `SELECT g."user_id", g."day", g."game", g."seconds", g."last_played_at" FROM "game_play_days" g
        INNER JOIN "members" m ON m."id" = g."user_id" AND m."guild_id" = $1
        WHERE g."day" >= $2 AND g."day" < $3`,
        [guildId, fromDay, toDay],
    );
    return rows.map((row) => ({
        user_id: String(row.user_id),
        day: String(row.day),
        game: row.game,
        seconds: Number(row.seconds),
        last_played_at:
            row.last_played_at instanceof Date
                ? row.last_played_at
                : new Date(`${String(row.last_played_at).replace(" ", "T")}${/Z|[+-]\d\d:?\d\d$/.test(String(row.last_played_at)) ? "" : "Z"}`),
    }));
}
