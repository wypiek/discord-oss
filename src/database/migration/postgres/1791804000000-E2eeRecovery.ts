import { MigrationInterface, QueryRunner } from "typeorm";

export class E2eeRecovery1791804000000 implements MigrationInterface {
    name = "E2eeRecovery1791804000000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "e2ee_recovery" (
            "user_id" bigint PRIMARY KEY,
            "identity_key" varchar NOT NULL,
            "backup_public_key" varchar NOT NULL,
            "backup_version" integer NOT NULL,
            "encrypted_secret" varchar NOT NULL,
            "updated_at" timestamp with time zone NOT NULL,
            CONSTRAINT "FK_e2ee_recovery_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
        )`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "e2ee_recovery"`);
    }
}
