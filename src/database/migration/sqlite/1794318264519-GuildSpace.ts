import type { MigrationInterface, QueryRunner } from "typeorm";

const hasColumn = async (queryRunner: QueryRunner, table: string, name: string) => {
    const rows: { name: string }[] = await queryRunner.query(`PRAGMA table_info("${table}")`);
    return rows.some((row) => row.name === name);
};

export class GuildSpace1794318264519 implements MigrationInterface {
    name = "GuildSpace1794318264519";

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await hasColumn(queryRunner, "guilds", "guild_space"))) await queryRunner.query(`ALTER TABLE "guilds" ADD COLUMN "guild_space" text`);
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "game_play_days" ("user_id" int8 NOT NULL, "day" varchar(10) NOT NULL, "game" varchar(255) NOT NULL, "seconds" integer NOT NULL DEFAULT (0), "last_played_at" datetime NOT NULL DEFAULT ((strftime('%Y-%m-%d %H:%M:%f', 'now'))), PRIMARY KEY ("user_id", "day", "game"), CONSTRAINT "FK_game_play_days_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE)`,
        );
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_game_play_days_day" ON "game_play_days" ("day")`);
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "whiteboard_boards" ("channel_id" int8 PRIMARY KEY NOT NULL, "strokes" text NOT NULL DEFAULT ('[]'), "updated_at" datetime NOT NULL DEFAULT ((strftime('%Y-%m-%d %H:%M:%f', 'now'))), CONSTRAINT "FK_whiteboard_boards_channel_id" FOREIGN KEY ("channel_id") REFERENCES "channels" ("id") ON DELETE CASCADE)`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "whiteboard_boards"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "game_play_days"`);
        if (await hasColumn(queryRunner, "guilds", "guild_space")) await queryRunner.query(`ALTER TABLE "guilds" DROP COLUMN "guild_space"`);
    }
}
