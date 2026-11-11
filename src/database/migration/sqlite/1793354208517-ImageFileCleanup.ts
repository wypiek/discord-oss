import type { MigrationInterface, QueryRunner } from "typeorm";

const profileBanner = (row: string) => `CASE WHEN json_valid(${row}."profile") THEN json_extract(${row}."profile", '$.custom_banner_hash') END`;

const IMAGES: [table: string, name: string, column: string, hash: (row: string) => string, path: (row: string, hash: string) => string][] = [
    ["users", "avatar", "avatar", (row) => `${row}."avatar"`, (row, hash) => `'avatars/' || ${row}."id" || '/' || ${hash}`],
    ["users", "banner", "banner", (row) => `${row}."banner"`, (row, hash) => `'banners/' || ${row}."id" || '/' || ${hash}`],
    ["webhooks", "avatar", "avatar", (row) => `${row}."avatar"`, (row, hash) => `'avatars/' || ${row}."id" || '/' || ${hash}`],
    ["messages", "avatar", "avatar", (row) => `${row}."avatar"`, (row, hash) => `'avatars/' || ${row}."author_id" || '/' || ${hash}`],
    ["members", "avatar", "avatar", (row) => `${row}."avatar"`, (row, hash) => `'guilds/' || ${row}."guild_id" || '/users/' || ${row}."id" || '/avatars/' || ${hash}`],
    ["members", "banner", "banner", (row) => `${row}."banner"`, (row, hash) => `'guilds/' || ${row}."guild_id" || '/users/' || ${row}."id" || '/avatars/' || ${hash}`],
    ["guilds", "icon", "icon", (row) => `${row}."icon"`, (row, hash) => `'icons/' || ${row}."id" || '/' || ${hash}`],
    ["guilds", "banner", "banner", (row) => `${row}."banner"`, (row, hash) => `'banners/' || ${row}."id" || '/' || ${hash}`],
    ["guilds", "splash", "splash", (row) => `${row}."splash"`, (row, hash) => `'splashes/' || ${row}."id" || '/' || ${hash}`],
    ["guilds", "discovery_splash", "discovery_splash", (row) => `${row}."discovery_splash"`, (row, hash) => `'discovery-splashes/' || ${row}."id" || '/' || ${hash}`],
    ["guilds", "profile_custom_banner_hash", "profile", profileBanner, (row, hash) => `'guild-space/' || ${row}."id" || '/banner/' || ${hash}`],
    ["channels", "icon", "icon", (row) => `${row}."icon"`, (row, hash) => `'channel-icons/' || ${row}."id" || '/' || ${hash}`],
    ["roles", "icon", "icon", (row) => `${row}."icon"`, (row, hash) => `'role-icons/' || ${row}."id" || '/' || ${hash} || '.png'`],
    ["applications", "icon", "icon", (row) => `${row}."icon"`, (row, hash) => `'app-icons/' || ${row}."id" || '/' || ${hash}`],
    ["applications", "cover_image", "cover_image", (row) => `${row}."cover_image"`, (row, hash) => `'app-icons/' || ${row}."id" || '/' || ${hash}`],
    ["custom_games", "icon_hash", "icon_hash", (row) => `${row}."icon_hash"`, (row, hash) => `'app-icons/' || ${row}."id" || '/' || ${hash}`],
    ["custom_games", "cover_image_hash", "cover_image_hash", (row) => `${row}."cover_image_hash"`, (row, hash) => `'app-icons/' || ${row}."id" || '/' || ${hash}`],
    ["guild_scheduled_events", "image", "image", (row) => `${row}."image"`, (row, hash) => `'guild-events/' || ${row}."id" || '/' || ${hash}`],
];

const RECENT_AVATARS = `INSERT INTO "image_file_deletes" ("path")
    SELECT 'avatars/' || OLD."id" || '/' || json_extract(entry.value, '$.storage_hash')
    FROM json_each(CASE WHEN json_valid(OLD."recent_avatars") AND json_type(OLD."recent_avatars") = 'array' THEN OLD."recent_avatars" ELSE '[]' END) entry
    WHERE entry.type = 'object' AND json_type(entry.value, '$.storage_hash') = 'text'
    ON CONFLICT DO NOTHING`;

export class ImageFileCleanup1793354208517 implements MigrationInterface {
    name = "ImageFileCleanup1793354208517";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "image_file_deletes" ("path" varchar(2048) PRIMARY KEY NOT NULL, "created_at" datetime NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')))`,
        );
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_image_file_deletes_created_at" ON "image_file_deletes" ("created_at")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_messages_author_avatar" ON "messages" ("author_id", "avatar") WHERE "avatar" IS NOT NULL`);

        for (const [table, name, column, hash, path] of IMAGES) {
            const old = hash("OLD");
            const insert = `INSERT INTO "image_file_deletes" ("path") VALUES (${path("OLD", old)}) ON CONFLICT DO NOTHING;`;
            await queryRunner.query(
                `CREATE TRIGGER IF NOT EXISTS "TRG_${table}_${name}_image_file_update" AFTER UPDATE OF "${column}" ON "${table}"
                WHEN ${old} IS NOT NULL AND ${old} <> '' AND ${old} IS NOT ${hash("NEW")} BEGIN ${insert} END`,
            );
            await queryRunner.query(
                `CREATE TRIGGER IF NOT EXISTS "TRG_${table}_${name}_image_file_delete" AFTER DELETE ON "${table}" WHEN ${old} IS NOT NULL AND ${old} <> '' BEGIN ${insert} END`,
            );
        }
        await queryRunner.query(
            `CREATE TRIGGER IF NOT EXISTS "TRG_users_recent_avatars_image_file_update" AFTER UPDATE OF "recent_avatars" ON "users" WHEN OLD."recent_avatars" IS NOT NULL BEGIN ${RECENT_AVATARS}; END`,
        );
        await queryRunner.query(
            `CREATE TRIGGER IF NOT EXISTS "TRG_users_recent_avatars_image_file_delete" AFTER DELETE ON "users" WHEN OLD."recent_avatars" IS NOT NULL BEGIN ${RECENT_AVATARS}; END`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const suffix of ["update", "delete"]) {
            await queryRunner.query(`DROP TRIGGER IF EXISTS "TRG_users_recent_avatars_image_file_${suffix}"`);
            for (const [table, name] of IMAGES) await queryRunner.query(`DROP TRIGGER IF EXISTS "TRG_${table}_${name}_image_file_${suffix}"`);
        }
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_messages_author_avatar"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "image_file_deletes"`);
    }
}
