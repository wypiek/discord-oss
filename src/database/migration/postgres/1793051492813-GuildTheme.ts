import type { MigrationInterface, QueryRunner } from "typeorm";

export class GuildTheme1793051492813 implements MigrationInterface {
    name = "GuildTheme1793051492813";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "guilds" ADD COLUMN IF NOT EXISTS "theme" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "guilds" DROP COLUMN IF EXISTS "theme"`);
    }
}
