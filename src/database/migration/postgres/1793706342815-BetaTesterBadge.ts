import type { MigrationInterface, QueryRunner } from "typeorm";

export class BetaTesterBadge1793706342815 implements MigrationInterface {
    name = "BetaTesterBadge1793706342815";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "badges" ADD COLUMN IF NOT EXISTS "details" text`);
        await queryRunner.query(
            `INSERT INTO "badges" ("id", "description", "icon", "rarity", "details") SELECT '1000', 'Beta Tester', 'beta_tester', 5, 'Unlocked by being a {instance} Beta Tester' WHERE NOT EXISTS (SELECT 1 FROM "badges" WHERE "id" = '1000' OR "icon" = 'beta_tester')`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "badges" DROP COLUMN IF EXISTS "details"`);
    }
}
