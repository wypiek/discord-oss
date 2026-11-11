import { MigrationInterface, QueryRunner } from "typeorm";

export class MessageContentTrigramIndex1791139264587 implements MigrationInterface {
    name = "MessageContentTrigramIndex1791139264587";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DO $$ BEGIN CREATE EXTENSION IF NOT EXISTS pg_trgm; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pg_trgm is unavailable, message search stays unindexed'; END $$`,
        );
        await queryRunner.query(
            `DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN CREATE INDEX IF NOT EXISTS "IDX_messages_content_trgm" ON "messages" USING gin ("content" gin_trgm_ops); END IF; END $$`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_messages_content_trgm"`);
    }
}
