import type { MigrationInterface, QueryRunner } from "typeorm";

export class GuildSpace1794318264519 implements MigrationInterface {
    name = "GuildSpace1794318264519";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "guilds" ADD COLUMN IF NOT EXISTS "guild_space" jsonb`);
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "game_play_days" ("user_id" bigint NOT NULL, "day" varchar(10) NOT NULL, "game" varchar(255) NOT NULL, "seconds" integer NOT NULL DEFAULT 0, "last_played_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_game_play_days" PRIMARY KEY ("user_id", "day", "game"), CONSTRAINT "FK_game_play_days_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE)`,
        );
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_game_play_days_day" ON "game_play_days" ("day")`);
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "whiteboard_boards" ("channel_id" bigint NOT NULL, "strokes" jsonb NOT NULL DEFAULT '[]', "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_whiteboard_boards" PRIMARY KEY ("channel_id"), CONSTRAINT "FK_whiteboard_boards_channel_id" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE)`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "whiteboard_boards"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "game_play_days"`);
        await queryRunner.query(`ALTER TABLE "guilds" DROP COLUMN IF EXISTS "guild_space"`);
    }
}
