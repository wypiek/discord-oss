import { MigrationInterface, QueryRunner } from "typeorm";

export class E2eeTrust1791192847361 implements MigrationInterface {
    name = "E2eeTrust1791192847361";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "e2ee_key_backups" ADD COLUMN IF NOT EXISTS "trust" character varying`);
        await queryRunner.query(`ALTER TABLE "e2ee_key_backups" ADD COLUMN IF NOT EXISTS "trust_version" integer NOT NULL DEFAULT 0`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "e2ee_key_backups" DROP COLUMN IF EXISTS "trust_version"`);
        await queryRunner.query(`ALTER TABLE "e2ee_key_backups" DROP COLUMN IF EXISTS "trust"`);
    }
}
