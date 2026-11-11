import type { MigrationInterface, QueryRunner } from "typeorm";

export class UserActivityStats1793698214537 implements MigrationInterface {
    name = "UserActivityStats1793698214537";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "user_activity_stats" ("user_id" bigint NOT NULL, "game_seconds" bigint NOT NULL DEFAULT 0, "stream_seconds" bigint NOT NULL DEFAULT 0, "games" jsonb NOT NULL DEFAULT '[]', "tier_unlocks" jsonb NOT NULL DEFAULT '{}', "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_user_activity_stats" PRIMARY KEY ("user_id"), CONSTRAINT "FK_user_activity_stats_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE)`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "user_activity_stats"`);
    }
}
