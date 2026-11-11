import type { MigrationInterface, QueryRunner } from "typeorm";

const hasColumn = async (queryRunner: QueryRunner, table: string, name: string) => {
    const rows: { name: string }[] = await queryRunner.query(`PRAGMA table_info("${table}")`);
    return rows.some((row) => row.name === name);
};

export class StatusGroupsAndMetrics1793611472093 implements MigrationInterface {
    name = "StatusGroupsAndMetrics1793611472093";

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await hasColumn(queryRunner, "status_components", "group_id"))) await queryRunner.query(`ALTER TABLE "status_components" ADD COLUMN "group_id" int8`);
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "status_metrics" ("id" int8 PRIMARY KEY NOT NULL, "bucket_at" datetime NOT NULL, "requests" integer NOT NULL, "median_ms" integer NOT NULL)`,
        );
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_status_metrics_bucket_at" ON "status_metrics" ("bucket_at")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "status_metrics"`);
        if (await hasColumn(queryRunner, "status_components", "group_id")) await queryRunner.query(`ALTER TABLE "status_components" DROP COLUMN "group_id"`);
    }
}
