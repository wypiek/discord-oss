import type { MigrationInterface, QueryRunner } from "typeorm";

const LOSER = `v.vanity_url = true AND EXISTS (
    SELECT 1 FROM "invites" w
    WHERE w.vanity_url = true AND w.code <> v.code AND LOWER(w.code) = LOWER(v.code)
    AND (w.created_at < v.created_at OR (w.created_at = v.created_at AND w.code < v.code))
)`;

export class LowercaseVanityCodes1793318402771 implements MigrationInterface {
    name = "LowercaseVanityCodes1793318402771";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `UPDATE "guilds" SET "vanity_url_code" = NULL WHERE "vanity_url_code" IS NOT NULL AND EXISTS (SELECT 1 FROM "invites" v WHERE v.guild_id = "guilds"."id" AND v.code = "guilds"."vanity_url_code" AND ${LOSER})`,
        );
        await queryRunner.query(`DELETE FROM "invites" WHERE "code" IN (SELECT v.code FROM "invites" v WHERE ${LOSER})`);
        await queryRunner.query(
            `UPDATE "guilds" SET "vanity_url_code" = LOWER("vanity_url_code") WHERE "vanity_url_code" <> LOWER("vanity_url_code") AND EXISTS (SELECT 1 FROM "invites" v WHERE v.guild_id = "guilds"."id" AND v.code = "guilds"."vanity_url_code" AND v.vanity_url = true) AND NOT EXISTS (SELECT 1 FROM "invites" o WHERE o.code = LOWER("guilds"."vanity_url_code"))`,
        );
        await queryRunner.query(
            `UPDATE "invites" SET "code" = LOWER("code") WHERE "vanity_url" = true AND "code" <> LOWER("code") AND NOT EXISTS (SELECT 1 FROM "invites" o WHERE o.code = LOWER("invites"."code"))`,
        );
    }

    public async down(): Promise<void> {}
}
