import { createHash } from "node:crypto";
import type { MigrationInterface, QueryRunner } from "typeorm";

const HIGHEST_CLIENT_BADGE = 40;
const DEFAULT_BADGE = 0;

type TagProfile = { badge?: number; badge_color_primary?: string | null; badge_color_secondary?: string | null; badge_hash?: string | null };

const columnType = async (queryRunner: QueryRunner, table: string, column: string): Promise<string> =>
    (await queryRunner.query(`SELECT data_type FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`, [table, column]))[0].data_type;

export class RemoveCustomClanBadges1793607315842 implements MigrationInterface {
    name = "RemoveCustomClanBadges1793607315842";

    public async up(queryRunner: QueryRunner): Promise<void> {
        const profileType = await columnType(queryRunner, "guilds", "profile");
        const primaryGuildType = await columnType(queryRunner, "users", "primary_guild");
        const guilds: { id: string; profile: TagProfile | string }[] = await queryRunner.query(
            `SELECT id::text AS id, profile FROM guilds WHERE CASE WHEN jsonb_typeof(profile::jsonb -> 'badge') = 'number' THEN (profile::jsonb ->> 'badge')::numeric NOT BETWEEN 0 AND ${HIGHEST_CLIENT_BADGE} ELSE false END`,
        );
        for (const guild of guilds) {
            const profile: TagProfile = typeof guild.profile === "string" ? JSON.parse(guild.profile) : guild.profile;
            const previousHash = profile.badge_hash ?? null;
            profile.badge = DEFAULT_BADGE;
            profile.badge_hash = createHash("md5").update(`${profile.badge}:${profile.badge_color_primary}:${profile.badge_color_secondary}`).digest("hex");
            await queryRunner.query(`UPDATE guilds SET profile = CAST($1 AS ${profileType}) WHERE id::text = $2`, [JSON.stringify(profile), guild.id]);
            if (!previousHash) continue;
            await queryRunner.query(
                `UPDATE users SET primary_guild = CAST(jsonb_set(primary_guild::jsonb, '{badge}', to_jsonb($1::text)) AS ${primaryGuildType}) WHERE primary_guild::jsonb ->> 'identity_guild_id' = $2 AND primary_guild::jsonb ->> 'badge' = $3`,
                [profile.badge_hash, guild.id, previousHash],
            );
        }
    }

    public async down(): Promise<void> {}
}
