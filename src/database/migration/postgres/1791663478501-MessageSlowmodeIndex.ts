import { MigrationInterface, QueryRunner } from "typeorm";

export class MessageSlowmodeIndex1791663478501 implements MigrationInterface {
    name = "MessageSlowmodeIndex1791663478501";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_messages_slowmode_channel_author_timestamp" ON "messages" ("channel_id", "author_id", "timestamp" DESC) WHERE "webhook_id" IS NULL`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_messages_slowmode_channel_author_timestamp"`);
    }
}
