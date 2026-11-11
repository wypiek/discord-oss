import { MigrationInterface, QueryRunner } from "typeorm";

export class ModerationSafety1791362847193 implements MigrationInterface {
    name = "ModerationSafety1791362847193";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "guilds" ADD COLUMN IF NOT EXISTS "safety_alerts_channel_id" bigint`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_automod_rules_guild_id" ON "automod_rules" ("guild_id")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_automod_rules_guild_id"`);
        await queryRunner.query(`ALTER TABLE "guilds" DROP COLUMN IF EXISTS "safety_alerts_channel_id"`);
    }
}
