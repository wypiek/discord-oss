import type { MigrationInterface, QueryRunner } from "typeorm";

export class TypingIndicatorStyle1794017936482 implements MigrationInterface {
    name = "TypingIndicatorStyle1794017936482";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "typing_indicator_style" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "typing_indicator_style"`);
    }
}
