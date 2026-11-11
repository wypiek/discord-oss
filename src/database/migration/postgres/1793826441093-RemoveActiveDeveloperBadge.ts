import type { MigrationInterface, QueryRunner } from "typeorm";

export class RemoveActiveDeveloperBadge1793826441093 implements MigrationInterface {
    name = "RemoveActiveDeveloperBadge1793826441093";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DELETE FROM "badges" WHERE "icon" = '6bdc42827a38498929a4920da12695d9' AND NOT EXISTS (SELECT 1 FROM "users" WHERE CAST("badges"."id" AS bigint) = ANY("users"."badge_ids"))`,
        );
    }

    public async down(): Promise<void> {}
}
