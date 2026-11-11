import { createHash } from "node:crypto";
import type { MigrationInterface, QueryRunner } from "typeorm";

const HIGHEST_CLIENT_BADGE = 40;
const DEFAULT_BADGE = 0;

type TagProfile = { badge?: number; badge_color_primary?: string | null; badge_color_secondary?: string | null; badge_hash?: string | null };

export class RemoveCustomClanBadges1793607315842 implements MigrationInterface {
    name = "RemoveCustomClanBadges1793607315842";

    public async up(queryRunner: QueryRunner): Promise<void> {
        const guilds: { id: string; profile: string }[] = await queryRunner.query(
            `SELECT CAST("id" AS TEXT) AS "id", "profile" FROM "guilds" WHERE json_valid("profile") AND json_type("profile", '$.badge') IN ('integer', 'real') AND (json_extract("profile", '$.badge') < 0 OR json_extract("profile", '$.badge') > ${HIGHEST_CLIENT_BADGE})`,
        );
        for (const guild of guilds) {
            const profile: TagProfile = JSON.parse(guild.profile);
            const previousHash = profile.badge_hash ?? null;
            profile.badge = DEFAULT_BADGE;
            profile.badge_hash = createHash("md5").update(`${profile.badge}:${profile.badge_color_primary}:${profile.badge_color_secondary}`).digest("hex");
            await queryRunner.query(`UPDATE "guilds" SET "profile" = ? WHERE CAST("id" AS TEXT) = ?`, [JSON.stringify(profile), guild.id]);
            if (!previousHash) continue;
            await queryRunner.query(
                `UPDATE "users" SET "primary_guild" = json_set("primary_guild", '$.badge', ?) WHERE json_valid("primary_guild") AND CAST(json_extract("primary_guild", '$.identity_guild_id') AS TEXT) = ? AND json_extract("primary_guild", '$.badge') = ?`,
                [profile.badge_hash, guild.id, previousHash],
            );
        }
    }

    public async down(): Promise<void> {}
}
