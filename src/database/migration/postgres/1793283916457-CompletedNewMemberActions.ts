import type { MigrationInterface, QueryRunner } from "typeorm";

export class CompletedNewMemberActions1793283916457 implements MigrationInterface {
    name = "CompletedNewMemberActions1793283916457";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "completed_new_member_actions" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "members" DROP COLUMN IF EXISTS "completed_new_member_actions"`);
    }
}
