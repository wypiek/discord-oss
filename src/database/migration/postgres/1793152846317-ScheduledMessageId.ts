import type { MigrationInterface, QueryRunner } from "typeorm";

export class ScheduledMessageId1793152846317 implements MigrationInterface {
    name = "ScheduledMessageId1793152846317";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "scheduled_messages" ADD COLUMN IF NOT EXISTS "message_id" bigint`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "scheduled_messages" DROP COLUMN IF EXISTS "message_id"`);
    }
}
