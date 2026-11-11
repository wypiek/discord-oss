import type { MigrationInterface, QueryRunner } from "typeorm";

export class AuditLogGuildOrder1793214785163 implements MigrationInterface {
    name = "AuditLogGuildOrder1793214785163";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_audit_logs_guild_id_id" ON "audit_logs" ("guild_id", "id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_audit_logs_guild_id_action_type_id" ON "audit_logs" ("guild_id", "action_type", "id")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_audit_logs_guild_id_action_type_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_audit_logs_guild_id_id"`);
    }
}
