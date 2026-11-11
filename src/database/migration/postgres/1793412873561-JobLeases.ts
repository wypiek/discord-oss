import type { MigrationInterface, QueryRunner } from "typeorm";

export class JobLeases1793412873561 implements MigrationInterface {
    name = "JobLeases1793412873561";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "job_leases" ("name" varchar(255) PRIMARY KEY NOT NULL, "holder" varchar(64) NOT NULL, "expires_at" bigint NOT NULL)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "job_leases"`);
    }
}
