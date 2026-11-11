import type { MigrationInterface, QueryRunner } from "typeorm";

export class PushDeviceAccounts1793094417263 implements MigrationInterface {
    name = "PushDeviceAccounts1793094417263";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "UQ_push_devices_provider_token"`);
        await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_push_devices_provider_token_user" ON "push_devices" ("provider", "token", "user_id")`);
    }

    public async down(): Promise<void> {}
}
