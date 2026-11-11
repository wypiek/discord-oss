import { MigrationInterface, QueryRunner } from "typeorm";

export class MessagePurgeQueue1791175306841 implements MigrationInterface {
    name = "MessagePurgeQueue1791175306841";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "message_purges" ("channel_id" bigint PRIMARY KEY, "created_at" timestamptz NOT NULL DEFAULT now())`);
        await queryRunner.query(
            `CREATE OR REPLACE FUNCTION "queue_message_purge"() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                INSERT INTO "message_purges" ("channel_id") VALUES (OLD."id") ON CONFLICT DO NOTHING;
                RETURN OLD;
            END $$`,
        );
        await queryRunner.query(`DROP TRIGGER IF EXISTS "TRG_channels_queue_message_purge" ON "channels"`);
        await queryRunner.query(`CREATE TRIGGER "TRG_channels_queue_message_purge" AFTER DELETE ON "channels" FOR EACH ROW EXECUTE FUNCTION "queue_message_purge"()`);
        await queryRunner.query(`ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "FK_message_channel_id"`);
        await queryRunner.query(`ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "FK_message_guild_id"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DELETE FROM "messages" m WHERE m."channel_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "channels" c WHERE c."id" = m."channel_id")`);
        await queryRunner.query(`DELETE FROM "messages" m WHERE m."guild_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "guilds" g WHERE g."id" = m."guild_id")`);
        await queryRunner.query(
            `ALTER TABLE "messages" ADD CONSTRAINT "FK_message_channel_id" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
        );
        await queryRunner.query(
            `ALTER TABLE "messages" ADD CONSTRAINT "FK_message_guild_id" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
        );
        await queryRunner.query(`DROP TRIGGER IF EXISTS "TRG_channels_queue_message_purge" ON "channels"`);
        await queryRunner.query(`DROP FUNCTION IF EXISTS "queue_message_purge"()`);
        await queryRunner.query(`DROP TABLE IF EXISTS "message_purges"`);
    }
}
