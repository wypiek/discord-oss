import { MigrationInterface, QueryRunner } from "typeorm";

export class BanGuildUserIndex1791174820593 implements MigrationInterface {
    name = "BanGuildUserIndex1791174820593";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_bans_guild_user" ON "bans" ("guild_id", "user_id")`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_bans_guild_id"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_bans_guild_id" ON "bans" ("guild_id")`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_bans_guild_user"`);
    }
}
