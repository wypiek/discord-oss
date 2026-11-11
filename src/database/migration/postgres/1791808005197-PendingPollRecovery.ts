import { MigrationInterface, QueryRunner } from "typeorm";

export class PendingPollRecovery1791808005197 implements MigrationInterface {
    name = "PendingPollRecovery1791808005197";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_messages_pending_polls" ON "messages" ("id")
            WHERE "poll" IS NOT NULL AND COALESCE("poll"->'results'->>'is_finalized', 'false') <> 'true'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_messages_pending_polls"`);
    }
}
