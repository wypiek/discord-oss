import { MigrationInterface, QueryRunner } from "typeorm";

export class PrideBadges1791663479903 implements MigrationInterface {
    name = "PrideBadges1791663479903";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pride_badges" text[] NOT NULL DEFAULT '{}'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "pride_badges"`);
    }
}
