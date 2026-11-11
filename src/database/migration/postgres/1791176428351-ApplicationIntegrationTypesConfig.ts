import { MigrationInterface, QueryRunner } from "typeorm";

export class ApplicationIntegrationTypesConfig1791176428351 implements MigrationInterface {
    name = "ApplicationIntegrationTypesConfig1791176428351";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "integration_types_config" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "applications" DROP COLUMN IF EXISTS "integration_types_config"`);
    }
}
