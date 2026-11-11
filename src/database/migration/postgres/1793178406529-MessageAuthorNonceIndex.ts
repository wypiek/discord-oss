import type { MigrationInterface, QueryRunner } from "typeorm";

export class MessageAuthorNonceIndex1793178406529 implements MigrationInterface {
    name = "MessageAuthorNonceIndex1793178406529";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_messages_author_nonce" ON "messages" ("author_id", "nonce") WHERE "nonce" IS NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_messages_author_nonce"`);
    }
}
