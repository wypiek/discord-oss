import type { MigrationInterface, QueryRunner } from "typeorm";

const FEDERATION_TABLES = [
    "federation_state",
    "federation_peers",
    "federation_blocks",
    "federation_verified_guilds",
    "federated_objects",
    "federation_deliveries",
    "federated_e2ee_keys",
    "federation_outbox",
    "federation_inbox_events",
    "federation_moves",
    "federation_instance_keys",
];

const DROPPED_COLUMNS: [string, string][] = [
    ["users", "federated_instance"],
    ["users", "remote_badges"],
    ["guilds", "federated_instance"],
    ["guilds", "global_discovery"],
    ["guilds", "global_discovery_hidden"],
    ["guilds", "global_discovery_verified"],
    ["channels", "federated_instance"],
    ["messages", "authorship"],
    ["former_recipients", "host_instance"],
];

const REMOVED_USERS = `SELECT "id" FROM "removed_users"`;
const REMOVED_GUILDS = `SELECT "id" FROM "removed_guilds"`;
const REMOVED_CHANNELS = `SELECT "id" FROM "removed_channels"`;

async function removeRemoteData(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run(`DROP TABLE IF EXISTS "removed_users", "removed_guilds", "removed_channels", "touched_guilds", "inherited_guilds"`);
    await run(`CREATE TEMP TABLE "removed_users" AS SELECT "id", "settingsIndex" FROM "users" WHERE "federated_instance" IS NOT NULL`);
    await run(`CREATE TEMP TABLE "removed_guilds" AS SELECT "id" FROM "guilds" WHERE "federated_instance" IS NOT NULL`);
    await run(`CREATE TEMP TABLE "touched_guilds" AS SELECT DISTINCT "guild_id" AS "id" FROM "members" WHERE "id" IN (${REMOVED_USERS}) AND "guild_id" NOT IN (${REMOVED_GUILDS})`);

    await run(`CREATE TEMP TABLE "inherited_guilds" AS SELECT "id" FROM "guilds" WHERE "owner_id" IN (${REMOVED_USERS}) AND "id" NOT IN (${REMOVED_GUILDS})`);
    await run(
        `UPDATE "guilds" g SET "owner_id" = (
            SELECT m."id" FROM "members" m
            LEFT JOIN "member_roles" mr ON mr."index" = m."index"
            LEFT JOIN "roles" r ON r."id" = mr."role_id"
            WHERE m."guild_id" = g."id" AND m."id" NOT IN (${REMOVED_USERS})
            GROUP BY m."id" ORDER BY MAX(COALESCE(r."position", -1)) DESC, m."id" LIMIT 1
        ) WHERE g."id" IN (SELECT "id" FROM "inherited_guilds")`,
    );
    await run(`INSERT INTO "removed_guilds" SELECT "id" FROM "guilds" WHERE "owner_id" IS NULL AND "id" IN (SELECT "id" FROM "inherited_guilds")`);

    await run(
        `CREATE TEMP TABLE "removed_channels" AS SELECT "id" FROM "channels" WHERE "federated_instance" IS NOT NULL OR "guild_id" IN (${REMOVED_GUILDS})
        OR ("type" = 1 AND "id" IN (SELECT "channel_id" FROM "recipients" WHERE "user_id" IN (${REMOVED_USERS})))
        OR ("type" = 3 AND "id" IN (SELECT "channel_id" FROM "recipients" WHERE "user_id" IN (${REMOVED_USERS}))
            AND NOT EXISTS (SELECT 1 FROM "recipients" r WHERE r."channel_id" = "channels"."id" AND r."user_id" NOT IN (${REMOVED_USERS})))`,
    );
    await run(
        `UPDATE "channels" c SET "owner_id" = (
            SELECT r."user_id" FROM "recipients" r WHERE r."channel_id" = c."id" AND r."user_id" NOT IN (${REMOVED_USERS}) ORDER BY r."id" LIMIT 1
        ) WHERE c."owner_id" IN (${REMOVED_USERS}) AND c."type" = 3 AND c."id" NOT IN (${REMOVED_CHANNELS})`,
    );
    await run(`UPDATE "channels" SET "owner_id" = NULL WHERE "owner_id" IN (${REMOVED_USERS})`);

    if (await queryRunner.hasTable("federated_objects")) await run(`DELETE FROM "e2ee_backup_keys" WHERE "message_id"::text IN (SELECT "local_id" FROM "federated_objects")`);
    await run(
        `DELETE FROM "e2ee_backup_keys" WHERE "message_id" IN (SELECT "id" FROM "messages" WHERE "channel_id" IN (${REMOVED_CHANNELS}) OR "author_id" IN (${REMOVED_USERS}))`,
    );

    await run(`UPDATE "applications" SET "guild_id" = NULL WHERE "guild_id" IN (${REMOVED_GUILDS})`);
    await run(
        `UPDATE "messages" SET "application_id" = NULL WHERE "application_id" IN (SELECT "id" FROM "applications" WHERE "owner_id" IN (${REMOVED_USERS}) OR "bot_user_id" IN (${REMOVED_USERS}))`,
    );
    await run(`UPDATE "guilds" SET "template_id" = NULL WHERE "template_id" IN (SELECT "id" FROM "templates" WHERE "source_guild_id" IN (${REMOVED_GUILDS}))`);
    await run(
        `UPDATE "sticker_packs" SET "coverStickerId" = NULL WHERE "coverStickerId" IN (SELECT "id" FROM "stickers" WHERE "guild_id" IN (${REMOVED_GUILDS}) OR "user_id" IN (${REMOVED_USERS}))`,
    );
    await run(`UPDATE "audit_logs" SET "user_id" = NULL WHERE "user_id" IN (${REMOVED_USERS})`);
    await run(`UPDATE "bans" SET "executor_id" = NULL WHERE "executor_id" IN (${REMOVED_USERS})`);
    await run(`UPDATE "emojis" SET "user_id" = NULL WHERE "user_id" IN (${REMOVED_USERS})`);
    await run(`UPDATE "teams" SET "owner_user_id" = NULL WHERE "owner_user_id" IN (${REMOVED_USERS})`);
    await run(`UPDATE "templates" SET "creator_id" = NULL WHERE "creator_id" IN (${REMOVED_USERS})`);
    await run(`DELETE FROM "user_settings_protos" WHERE "user_id" IN (${REMOVED_USERS})`);

    await run(`DELETE FROM "guilds" WHERE "id" IN (${REMOVED_GUILDS})`);
    await run(`DELETE FROM "channels" WHERE "id" IN (${REMOVED_CHANNELS})`);
    await run(`DELETE FROM "users" WHERE "id" IN (${REMOVED_USERS})`);
    await run(`DELETE FROM "user_settings" WHERE "index" IN (SELECT "settingsIndex" FROM "removed_users")`);
    await run(`DELETE FROM "former_recipients" WHERE "user_id" IN (${REMOVED_USERS}) OR "channel_id" IN (${REMOVED_CHANNELS})`);
    await run(`UPDATE "guilds" g SET "member_count" = (SELECT COUNT(*) FROM "members" m WHERE m."guild_id" = g."id") WHERE g."id" IN (SELECT "id" FROM "touched_guilds")`);
    await run(`DROP TABLE IF EXISTS "removed_users", "removed_guilds", "removed_channels", "touched_guilds", "inherited_guilds"`);
}

export class RemoveFederation1793617294853 implements MigrationInterface {
    name = "RemoveFederation1793617294853";

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (
            (await queryRunner.hasColumn("users", "federated_instance")) &&
            (await queryRunner.hasColumn("guilds", "federated_instance")) &&
            (await queryRunner.hasColumn("channels", "federated_instance"))
        )
            await removeRemoteData(queryRunner);
        const versionTwo = `SELECT "id" FROM "messages" WHERE "encrypted" IS NOT NULL AND "encrypted"->>'v' = '2'`;
        await queryRunner.query(`DELETE FROM "e2ee_backup_keys" WHERE "message_id" IN (${versionTwo})`);
        await queryRunner.query(`DELETE FROM "messages" WHERE "id" IN (${versionTwo})`);
        await queryRunner.query(`DELETE FROM "reports" WHERE "type" = 'federated_automod'`);
        await queryRunner.query(`DELETE FROM "automod_actions" WHERE "action" = 'federation_block'`);
        await queryRunner.query(`DELETE FROM "config" WHERE substr("key", 1, 11) = 'federation_' OR substr("key", 1, 19) = 'automod_federation_'`);
        await queryRunner.query(`DELETE FROM "job_leases" WHERE substr("name", 1, 10) = 'federation'`);

        if (await queryRunner.hasTable("former_recipients"))
            await queryRunner.query(
                `CREATE OR REPLACE FUNCTION "record_former_recipient"() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    INSERT INTO "former_recipients" ("channel_id", "user_id", "left_at")
                    SELECT OLD."channel_id", OLD."user_id", now() FROM "channels" c WHERE c."id" = OLD."channel_id" AND c."type" IN (1, 3)
                    ON CONFLICT ("channel_id", "user_id") DO UPDATE SET "left_at" = EXCLUDED."left_at";
                    RETURN OLD;
                END $$`,
            );
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_guilds_global_discovery"`);
        for (const table of ["users", "guilds", "channels"]) await queryRunner.query(`DROP INDEX IF EXISTS "IDX_${table}_federated_instance"`);
        for (const [table, column] of DROPPED_COLUMNS) await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "${column}"`);
        for (const table of FEDERATION_TABLES) await queryRunner.query(`DROP TABLE IF EXISTS "${table}"`);
    }

    public async down(): Promise<void> {}
}
