import type { MigrationInterface, QueryRunner } from "typeorm";

const hasColumn = async (queryRunner: QueryRunner, table: string, name: string) => {
    const rows: { name: string }[] = await queryRunner.query(`PRAGMA table_info("${table}")`);
    return rows.some((row) => row.name === name);
};

export class IpHashGroups1794163870529 implements MigrationInterface {
    name = "IpHashGroups1794163870529";

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await hasColumn(queryRunner, "users", "registration_ip_group"))) await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "registration_ip_group" varchar`);
        if (!(await hasColumn(queryRunner, "sessions", "last_seen_ip_group"))) await queryRunner.query(`ALTER TABLE "sessions" ADD COLUMN "last_seen_ip_group" varchar`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_users_registration_ip_group" ON "users" ("registration_ip_group")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_sessions_last_seen_ip_group" ON "sessions" ("last_seen_ip_group")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_sessions_last_seen_ip_group"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_registration_ip_group"`);
        if (await hasColumn(queryRunner, "sessions", "last_seen_ip_group")) await queryRunner.query(`ALTER TABLE "sessions" DROP COLUMN "last_seen_ip_group"`);
        if (await hasColumn(queryRunner, "users", "registration_ip_group")) await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "registration_ip_group"`);
    }
}
