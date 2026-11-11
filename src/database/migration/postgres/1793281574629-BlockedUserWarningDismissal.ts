import type { MigrationInterface, QueryRunner } from "typeorm";

export class BlockedUserWarningDismissal1793281574629 implements MigrationInterface {
    name = "BlockedUserWarningDismissal1793281574629";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "recipients" ADD COLUMN IF NOT EXISTS "blocked_user_warning_dismissed" boolean NOT NULL DEFAULT false`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "recipients" DROP COLUMN IF EXISTS "blocked_user_warning_dismissed"`);
    }
}
