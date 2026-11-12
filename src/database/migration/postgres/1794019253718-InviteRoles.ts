import type { MigrationInterface, QueryRunner } from "typeorm";

export class InviteRoles1794019253718 implements MigrationInterface {
    name = "InviteRoles1794019253718";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "invites" ADD COLUMN IF NOT EXISTS "role_ids" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "invites" DROP COLUMN IF EXISTS "role_ids"`);
    }
}
