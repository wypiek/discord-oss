// Copyright Spacebar & contributors 2026 (AGPLv3)
import { MigrationInterface, QueryRunner } from "typeorm";

export class StorageRuntime1791809004004 implements MigrationInterface {
    name = "StorageRuntime1791809004004";
    async up(runner: QueryRunner): Promise<void> {
        await runner.query(`CREATE TABLE IF NOT EXISTS storage_runtime_objects (
            namespace varchar(128) NOT NULL, path varchar(2048) NOT NULL, principal varchar(128) NOT NULL,
            category varchar NOT NULL, budget_principal varchar(128) NOT NULL, bytes bigint NOT NULL DEFAULT 0 CHECK(bytes>=0),
            reserved_bytes bigint NOT NULL DEFAULT 0 CHECK(reserved_bytes>=0), pending boolean NOT NULL DEFAULT false, operation_generation varchar NOT NULL DEFAULT '',
            PRIMARY KEY(namespace,path))`);
        await runner.query("CREATE INDEX IF NOT EXISTS storage_runtime_principal ON storage_runtime_objects(namespace,principal)");
    }
    async down(runner: QueryRunner): Promise<void> {
        await runner.query("DROP TABLE IF EXISTS storage_runtime_objects");
    }
}
