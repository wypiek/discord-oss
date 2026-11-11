import { MigrationInterface, QueryRunner } from "typeorm";

export class AdminUserSearchIndexes1791662548137 implements MigrationInterface {
    name = "AdminUserSearchIndexes1791662548137";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_users_admin_created_id" ON "users" ("created_at" DESC, "id" DESC)`);
        await queryRunner.query(
            `DO $$ BEGIN CREATE EXTENSION IF NOT EXISTS pg_trgm; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pg_trgm is unavailable, admin user substring search stays unindexed'; END $$`,
        );
        for (const column of ["username", "global_name", "email"]) {
            await queryRunner.query(
                `DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN CREATE INDEX IF NOT EXISTS "IDX_users_admin_${column}_trgm" ON "users" USING gin ("${column}" gin_trgm_ops); END IF; END $$`,
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const column of ["username", "global_name", "email"]) await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_admin_${column}_trgm"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_admin_created_id"`);
    }
}
