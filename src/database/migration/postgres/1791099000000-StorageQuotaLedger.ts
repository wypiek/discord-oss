import { MigrationInterface, QueryRunner } from "typeorm";

export class StorageQuotaLedger1791099000000 implements MigrationInterface {
    name = "StorageQuotaLedger1791099000000";
    async up(runner: QueryRunner): Promise<void> {
        await runner.query(`CREATE TABLE storage_quota_accounts (
            namespace varchar NOT NULL, key varchar NOT NULL,
            used_bytes bigint NOT NULL DEFAULT 0 CHECK (used_bytes >= 0), reserved_bytes bigint NOT NULL DEFAULT 0 CHECK (reserved_bytes >= 0),
            used_objects bigint NOT NULL DEFAULT 0 CHECK (used_objects >= 0), reserved_objects bigint NOT NULL DEFAULT 0 CHECK (reserved_objects >= 0),
            state varchar NOT NULL DEFAULT 'inventory-required', PRIMARY KEY(namespace, key))`);
        await runner.query(`CREATE TABLE storage_quota_objects (
            namespace varchar NOT NULL, path varchar NOT NULL, principal varchar NOT NULL, category varchar NOT NULL,
            bytes bigint NOT NULL DEFAULT 0 CHECK (bytes >= 0), generation varchar NOT NULL,
            pending_operation varchar, state varchar NOT NULL DEFAULT 'reserved', PRIMARY KEY(namespace, path))`);
        await runner.query(`CREATE TABLE storage_quota_operations (
            namespace varchar NOT NULL, id varchar NOT NULL, path varchar NOT NULL, principal varchar NOT NULL, category varchar NOT NULL,
            upper_bytes bigint NOT NULL CHECK (upper_bytes >= 0), prior_bytes bigint NOT NULL CHECK (prior_bytes >= 0),
            prior_exists boolean NOT NULL, prior_generation varchar NOT NULL, state varchar NOT NULL DEFAULT 'reserved',
            actual_bytes bigint CHECK (actual_bytes >= 0), created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(namespace, id))`);
        await runner.query(`CREATE INDEX storage_quota_operations_recovery ON storage_quota_operations(namespace, state, created_at)`);
    }
    async down(runner: QueryRunner): Promise<void> {
        await runner.query("DROP TABLE storage_quota_operations");
        await runner.query("DROP TABLE storage_quota_objects");
        await runner.query("DROP TABLE storage_quota_accounts");
    }
}
