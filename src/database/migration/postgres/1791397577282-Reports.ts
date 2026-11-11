import { MigrationInterface, QueryRunner } from "typeorm";

export class Reports1791397577282 implements MigrationInterface {
    name = "Reports1791397577282";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "reports" ("id" bigint NOT NULL, "type" character varying NOT NULL, "status" character varying NOT NULL DEFAULT 'open', "reporter_id" bigint, "reported_user_id" bigint, "guild_id" bigint, "channel_id" bigint, "message_id" bigint, "application_id" bigint, "stage_instance_id" bigint, "guild_scheduled_event_id" bigint, "widget_id" character varying, "reason" text NOT NULL DEFAULT '', "breadcrumbs" jsonb NOT NULL DEFAULT '[]', "elements" jsonb NOT NULL DEFAULT '{}', "snapshot" jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "resolved_by" bigint, "resolved_at" TIMESTAMP WITH TIME ZONE, "resolution_note" text, "violation_id" bigint, CONSTRAINT "PK_reports_id" PRIMARY KEY ("id"))`,
        );
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_reports_status_created_at" ON "reports" ("status", "created_at")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_reports_reported_user_id" ON "reports" ("reported_user_id")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "reports"`);
    }
}
