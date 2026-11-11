import { MigrationInterface, QueryRunner } from "typeorm";

export class GuildInsights1791448273615 implements MigrationInterface {
    name = "GuildInsights1791448273615";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "guild_insights_daily" ("guild_id" bigint NOT NULL, "day" date NOT NULL, "metric" character varying NOT NULL, "key" character varying NOT NULL DEFAULT '', "value" bigint NOT NULL DEFAULT 0, CONSTRAINT "PK_guild_insights_daily" PRIMARY KEY ("guild_id", "day", "metric", "key"), CONSTRAINT "FK_guild_insights_daily_guild_id" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
        );
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "guild_insights_activity" ("guild_id" bigint NOT NULL, "day" date NOT NULL, "channel_id" bigint NOT NULL, "user_id" bigint NOT NULL, "kinds" integer NOT NULL DEFAULT 0, CONSTRAINT "PK_guild_insights_activity" PRIMARY KEY ("guild_id", "day", "channel_id", "user_id"), CONSTRAINT "FK_guild_insights_activity_guild_id" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
        );
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_guild_insights_activity_day" ON "guild_insights_activity" ("day")`);
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "guild_insights_rollups" ("day" date NOT NULL, "rolled_up_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_guild_insights_rollups" PRIMARY KEY ("day"))`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "guild_insights_rollups"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "guild_insights_activity"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "guild_insights_daily"`);
    }
}
