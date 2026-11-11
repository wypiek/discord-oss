import { MigrationInterface, QueryRunner } from "typeorm";

export class UnifyReports1791412046517 implements MigrationInterface {
    name = "UnifyReports1791412046517";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "violation_id" bigint`);
        const [{ exists }] = await queryRunner.query(`SELECT to_regclass('public.user_reports') IS NOT NULL AS "exists"`);
        if (!exists) return;
        await queryRunner.query(
            `INSERT INTO "reports" ("id", "type", "status", "reporter_id", "reported_user_id", "guild_id", "channel_id", "message_id", "breadcrumbs", "elements", "snapshot", "created_at", "resolved_by", "resolved_at", "violation_id")
            SELECT "id", "type",
                CASE "status" WHEN 1 THEN 'resolved' WHEN 2 THEN 'dismissed' ELSE 'open' END,
                "reporter_id", "reported_user_id", "guild_id", "channel_id", "message_id", "breadcrumbs", "elements",
                CASE WHEN "snapshot" IS NULL THEN NULL WHEN "snapshot" ? 'timestamp' THEN ("snapshot" - 'timestamp') || jsonb_build_object('sent_at', "snapshot" -> 'timestamp') ELSE "snapshot" END,
                "created_at", "resolved_by", "resolved_at", "violation_id"
            FROM "user_reports"
            ON CONFLICT ("id") DO NOTHING`,
        );
        await queryRunner.query(`DROP TABLE "user_reports"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "reports" DROP COLUMN IF EXISTS "violation_id"`);
    }
}
