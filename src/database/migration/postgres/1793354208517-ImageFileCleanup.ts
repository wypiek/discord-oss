import type { MigrationInterface, QueryRunner } from "typeorm";

const IMAGES: [table: string, column: string, path: string][] = [
    ["users", "avatar", "avatars/{id}/{hash}"],
    ["users", "banner", "banners/{id}/{hash}"],
    ["webhooks", "avatar", "avatars/{id}/{hash}"],
    ["messages", "avatar", "avatars/{author_id}/{hash}"],
    ["members", "avatar", "guilds/{guild_id}/users/{id}/avatars/{hash}"],
    ["members", "banner", "guilds/{guild_id}/users/{id}/avatars/{hash}"],
    ["guilds", "icon", "icons/{id}/{hash}"],
    ["guilds", "banner", "banners/{id}/{hash}"],
    ["guilds", "splash", "splashes/{id}/{hash}"],
    ["guilds", "discovery_splash", "discovery-splashes/{id}/{hash}"],
    ["guilds", "profile.custom_banner_hash", "guild-space/{id}/banner/{hash}"],
    ["channels", "icon", "channel-icons/{id}/{hash}"],
    ["roles", "icon", "role-icons/{id}/{hash}.png"],
    ["applications", "icon", "app-icons/{id}/{hash}"],
    ["applications", "cover_image", "app-icons/{id}/{hash}"],
    ["custom_games", "icon_hash", "app-icons/{id}/{hash}"],
    ["custom_games", "cover_image_hash", "app-icons/{id}/{hash}"],
    ["guild_scheduled_events", "image", "guild-events/{id}/{hash}"],
];

const triggerName = (table: string, column: string) => `TRG_${table}_${column.replace(/\./g, "_")}_image_file`;

export class ImageFileCleanup1793354208517 implements MigrationInterface {
    name = "ImageFileCleanup1793354208517";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "image_file_deletes" ("path" varchar(2048) PRIMARY KEY, "created_at" timestamptz NOT NULL DEFAULT now())`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_image_file_deletes_created_at" ON "image_file_deletes" ("created_at")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_messages_author_avatar" ON "messages" ("author_id", "avatar") WHERE "avatar" IS NOT NULL`);

        await queryRunner.query(
            `CREATE OR REPLACE FUNCTION "queue_image_file_delete"() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE
                field text[] := string_to_array(TG_ARGV[0], '.');
                old_row jsonb := to_jsonb(OLD);
                hash text := old_row #>> field;
            BEGIN
                IF hash IS NULL OR hash = '' THEN RETURN NULL; END IF;
                IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) #>> field) IS NOT DISTINCT FROM hash THEN RETURN NULL; END IF;
                INSERT INTO "image_file_deletes" ("path") VALUES (
                    replace(replace(replace(replace(TG_ARGV[1], '{hash}', hash), '{id}', coalesce(old_row->>'id', '')), '{guild_id}', coalesce(old_row->>'guild_id', '')), '{author_id}', coalesce(old_row->>'author_id', ''))
                ) ON CONFLICT DO NOTHING;
                RETURN NULL;
            END $$`,
        );
        await queryRunner.query(
            `CREATE OR REPLACE FUNCTION "queue_recent_avatar_files"() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                INSERT INTO "image_file_deletes" ("path")
                SELECT 'avatars/' || OLD."id" || '/' || (entry->>'storage_hash')
                FROM jsonb_array_elements(CASE WHEN jsonb_typeof(OLD."recent_avatars") = 'array' THEN OLD."recent_avatars" ELSE '[]'::jsonb END) entry
                WHERE jsonb_typeof(entry->'storage_hash') = 'string'
                ON CONFLICT DO NOTHING;
                RETURN NULL;
            END $$`,
        );

        for (const [table, column, path] of IMAGES) {
            const stored = column.split(".")[0];
            await queryRunner.query(`DROP TRIGGER IF EXISTS "${triggerName(table, column)}" ON "${table}"`);
            await queryRunner.query(
                `CREATE TRIGGER "${triggerName(table, column)}" AFTER UPDATE OF "${stored}" OR DELETE ON "${table}" FOR EACH ROW
                WHEN (OLD."${stored}" IS NOT NULL) EXECUTE FUNCTION "queue_image_file_delete"('${column}', '${path}')`,
            );
        }
        await queryRunner.query(`DROP TRIGGER IF EXISTS "TRG_users_recent_avatars_image_file" ON "users"`);
        await queryRunner.query(
            `CREATE TRIGGER "TRG_users_recent_avatars_image_file" AFTER UPDATE OF "recent_avatars" OR DELETE ON "users" FOR EACH ROW
            WHEN (OLD."recent_avatars" IS NOT NULL) EXECUTE FUNCTION "queue_recent_avatar_files"()`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TRIGGER IF EXISTS "TRG_users_recent_avatars_image_file" ON "users"`);
        for (const [table, column] of IMAGES) await queryRunner.query(`DROP TRIGGER IF EXISTS "${triggerName(table, column)}" ON "${table}"`);
        await queryRunner.query(`DROP FUNCTION IF EXISTS "queue_recent_avatar_files"()`);
        await queryRunner.query(`DROP FUNCTION IF EXISTS "queue_image_file_delete"()`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_messages_author_avatar"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "image_file_deletes"`);
    }
}
