import type { MigrationInterface, QueryRunner } from "typeorm";

export class PendingInteractions1793264817342 implements MigrationInterface {
    name = "PendingInteractions1793264817342";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "pending_interactions" ("id" varchar PRIMARY KEY NOT NULL, "token" varchar NOT NULL, "application_id" varchar NOT NULL, "acknowledged" boolean NOT NULL DEFAULT false, "interaction_state" text NOT NULL, "expires_at" datetime NOT NULL)`,
        );
        await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_pending_interactions_token" ON "pending_interactions" ("token")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_pending_interactions_expires_at" ON "pending_interactions" ("expires_at")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "pending_interactions"`);
    }
}
