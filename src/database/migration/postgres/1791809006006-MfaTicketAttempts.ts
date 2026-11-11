import { MigrationInterface, QueryRunner } from "typeorm";

export class MfaTicketAttempts1791809006006 implements MigrationInterface {
    name = "MfaTicketAttempts1791809006006";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "mfa_ticket_attempts" (
            "ticket_hash" varchar(64) PRIMARY KEY,
            "attempts" integer NOT NULL CHECK ("attempts" BETWEEN 1 AND 5),
            "consumed" boolean NOT NULL DEFAULT false,
            "expires_at" timestamptz NOT NULL
        )`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_mfa_ticket_attempts_expiry" ON "mfa_ticket_attempts" ("expires_at")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "mfa_ticket_attempts"`);
    }
}
