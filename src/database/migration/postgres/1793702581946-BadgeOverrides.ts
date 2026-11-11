import type { MigrationInterface, QueryRunner } from "typeorm";

export class BadgeOverrides1793702581946 implements MigrationInterface {
    name = "BadgeOverrides1793702581946";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "badge_overrides" jsonb`);
        await queryRunner.query(`ALTER TABLE "badges" ADD COLUMN IF NOT EXISTS "rarity" integer`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "badges" DROP COLUMN IF EXISTS "rarity"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "badge_overrides"`);
    }
}
