import type { MigrationInterface, QueryRunner } from "typeorm";

export class StatusGroupsAndMetrics1793611472093 implements MigrationInterface {
    name = "StatusGroupsAndMetrics1793611472093";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "status_components" ADD COLUMN IF NOT EXISTS "group_id" bigint`);
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "status_metrics" ("id" bigint NOT NULL, "bucket_at" TIMESTAMP WITH TIME ZONE NOT NULL, "requests" integer NOT NULL, "median_ms" integer NOT NULL, CONSTRAINT "PK_status_metrics" PRIMARY KEY ("id"))`,
        );
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_status_metrics_bucket_at" ON "status_metrics" ("bucket_at")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "status_metrics"`);
        await queryRunner.query(`ALTER TABLE "status_components" DROP COLUMN IF EXISTS "group_id"`);
    }
}
