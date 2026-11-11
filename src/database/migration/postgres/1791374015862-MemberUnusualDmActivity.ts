import { MigrationInterface, QueryRunner } from "typeorm";

export class MemberUnusualDmActivity1791374015862 implements MigrationInterface {
    name = "MemberUnusualDmActivity1791374015862";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "unusual_dm_activity_until" TIMESTAMP WITH TIME ZONE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "members" DROP COLUMN IF EXISTS "unusual_dm_activity_until"`);
    }
}
