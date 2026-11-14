import { MigrationInterface, QueryRunner } from "typeorm";

export class GuildHomeHeader1794200000000 implements MigrationInterface {
    name = "GuildHomeHeader1794200000000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "guilds" ADD COLUMN IF NOT EXISTS "home_header" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "guilds" DROP COLUMN IF EXISTS "home_header"`);
    }
}
