import { MigrationInterface, QueryRunner } from "typeorm";

export class IpHashGroups1794163870529 implements MigrationInterface {
    name = "IpHashGroups1794163870529";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "registration_ip_group" character varying`);
        await queryRunner.query(`ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "last_seen_ip_group" character varying`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_users_registration_ip_group" ON "users" ("registration_ip_group")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_sessions_last_seen_ip_group" ON "sessions" ("last_seen_ip_group")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_sessions_last_seen_ip_group"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_registration_ip_group"`);
        await queryRunner.query(`ALTER TABLE "sessions" DROP COLUMN IF EXISTS "last_seen_ip_group"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "registration_ip_group"`);
    }
}
