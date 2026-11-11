import { MigrationInterface, QueryRunner } from "typeorm";
export class AnnouncementDelivery1791805000427 implements MigrationInterface {
    name = "AnnouncementDelivery1791805000427";
    async up(runner: QueryRunner): Promise<void> {
        await runner.query(`ALTER TABLE "announcements" ADD COLUMN IF NOT EXISTS "durable" boolean NOT NULL DEFAULT false`);
        await runner.query(`ALTER TABLE "announcements" ADD COLUMN IF NOT EXISTS "attachment_count" integer NOT NULL DEFAULT 0`);
        await runner.query(`CREATE TABLE IF NOT EXISTS "announcement_deliveries" (
            "announcement_id" bigint NOT NULL REFERENCES "announcements"("id") ON DELETE CASCADE,
            "user_id" bigint NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
            "status" varchar NOT NULL DEFAULT 'queued', "attempts" integer NOT NULL DEFAULT 0,
            "next_retry_at" timestamptz NOT NULL DEFAULT now(), "last_error" varchar,
            "message_id" bigint, "lease_token" varchar, PRIMARY KEY ("announcement_id", "user_id")
        )`);
        await runner.query(`ALTER TABLE "announcement_deliveries" ADD COLUMN IF NOT EXISTS "lease_token" varchar`);
        await runner.query(`CREATE INDEX IF NOT EXISTS "IDX_announcement_deliveries_ready" ON "announcement_deliveries" ("status", "next_retry_at")`);
    }
    async down(runner: QueryRunner): Promise<void> {
        await runner.query(`DROP TABLE IF EXISTS "announcement_deliveries"`);
        await runner.query(`ALTER TABLE "announcements" DROP COLUMN IF EXISTS "durable"`);
        await runner.query(`ALTER TABLE "announcements" DROP COLUMN IF EXISTS "attachment_count"`);
    }
}
