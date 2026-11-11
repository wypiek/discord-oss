import { MigrationInterface, QueryRunner } from "typeorm";

export class BuiltinStorePackCustomization1791662738491 implements MigrationInterface {
    name = "BuiltinStorePackCustomization1791662738491";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "store_hidden_packs" ADD COLUMN IF NOT EXISTS "hidden" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`ALTER TABLE "store_hidden_packs" ADD COLUMN IF NOT EXISTS "customization" jsonb NOT NULL DEFAULT '{}'::jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'store_hidden_packs' AND column_name = 'hidden') THEN DELETE FROM "store_hidden_packs" WHERE "hidden" = false; END IF; END $$`,
        );
        await queryRunner.query(`ALTER TABLE "store_hidden_packs" DROP COLUMN IF EXISTS "customization"`);
        await queryRunner.query(`ALTER TABLE "store_hidden_packs" DROP COLUMN IF EXISTS "hidden"`);
    }
}
