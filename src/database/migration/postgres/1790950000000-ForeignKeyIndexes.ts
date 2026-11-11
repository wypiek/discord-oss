import { MigrationInterface, QueryRunner } from "typeorm";

export class ForeignKeyIndexes1790950000000 implements MigrationInterface {
    name = "ForeignKeyIndexes1790950000000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_tags_channel_id" ON "tags" ("channel_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_channels_guild_id" ON "channels" ("guild_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_members_guild_id" ON "members" ("guild_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_roles_guild_id" ON "roles" ("guild_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_emojis_guild_id" ON "emojis" ("guild_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_stickers_guild_id" ON "stickers" ("guild_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_voice_states_guild_id" ON "voice_states" ("guild_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_voice_states_user_id" ON "voice_states" ("user_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_voice_states_channel_id" ON "voice_states" ("channel_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_read_states_user_id" ON "read_states" ("user_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_recipients_user_id" ON "recipients" ("user_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_recipients_channel_id" ON "recipients" ("channel_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_relationships_to_id" ON "relationships" ("to_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_thread_members_member_idx" ON "thread_members" ("member_idx")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_invites_guild_id" ON "invites" ("guild_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_invites_channel_id" ON "invites" ("channel_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_bans_guild_id" ON "bans" ("guild_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_webhooks_guild_id" ON "webhooks" ("guild_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_webhooks_channel_id" ON "webhooks" ("channel_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_attachments_message_id" ON "attachments" ("message_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_connected_accounts_user_id" ON "connected_accounts" ("user_id")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tags_channel_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_channels_guild_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_members_guild_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_roles_guild_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_emojis_guild_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_stickers_guild_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_voice_states_guild_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_voice_states_user_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_voice_states_channel_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_read_states_user_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_recipients_user_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_recipients_channel_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_relationships_to_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_thread_members_member_idx"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_invites_guild_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_invites_channel_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_bans_guild_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_webhooks_guild_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_webhooks_channel_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_attachments_message_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_connected_accounts_user_id"`);
    }
}
