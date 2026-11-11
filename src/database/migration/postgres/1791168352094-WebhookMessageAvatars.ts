import { MigrationInterface, QueryRunner } from "typeorm";

export class WebhookMessageAvatars1791168352094 implements MigrationInterface {
    name = "WebhookMessageAvatars1791168352094";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `UPDATE "messages" m
            SET "avatar" = u."avatar"
            FROM "users" u
            WHERE m."webhook_id" IS NOT NULL
                AND m."avatar" IS NULL
                AND u."id" = m."webhook_id"
                AND u."avatar" IS NOT NULL`,
        );
    }

    public async down(): Promise<void> {}
}
