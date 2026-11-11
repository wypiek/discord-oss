import type { MigrationInterface, QueryRunner } from "typeorm";

export class UserActivityStats1793698214537 implements MigrationInterface {
    name = "UserActivityStats1793698214537";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "user_activity_stats" ("user_id" int8 PRIMARY KEY NOT NULL, "game_seconds" bigint NOT NULL DEFAULT (0), "stream_seconds" bigint NOT NULL DEFAULT (0), "games" text NOT NULL DEFAULT ('[]'), "tier_unlocks" text NOT NULL DEFAULT ('{}'), "updated_at" datetime NOT NULL DEFAULT ((strftime('%Y-%m-%d %H:%M:%f', 'now'))), CONSTRAINT "FK_user_activity_stats_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE)`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "user_activity_stats"`);
    }
}
