import { MigrationInterface, QueryRunner } from "typeorm";

export class ScheduledMessageDeliveryLease1791568734927 implements MigrationInterface {
    name = "ScheduledMessageDeliveryLease1791568734927";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "scheduled_messages" ADD COLUMN IF NOT EXISTS "claim_token" uuid`);
        await queryRunner.query(`ALTER TABLE "scheduled_messages" ADD COLUMN IF NOT EXISTS "claim_until" timestamp with time zone`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "scheduled_messages" DROP COLUMN IF EXISTS "claim_until"`);
        await queryRunner.query(`ALTER TABLE "scheduled_messages" DROP COLUMN IF EXISTS "claim_token"`);
    }
}
