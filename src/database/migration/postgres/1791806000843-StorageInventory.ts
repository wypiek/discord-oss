import { MigrationInterface, QueryRunner } from "typeorm";
export class StorageInventory1791806000843 implements MigrationInterface {
    name = "StorageInventory1791806000843";
    async up(runner: QueryRunner): Promise<void> {
        await runner.query(`CREATE TABLE IF NOT EXISTS storage_inventory_runs (
   namespace varchar PRIMARY KEY,epoch varchar NOT NULL,root_identity varchar NOT NULL,barrier_digest varchar NOT NULL,
   state varchar NOT NULL DEFAULT 'running',phase varchar NOT NULL DEFAULT 'content',error_code varchar,
   policy jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,completed_at timestamptz)`);
        await runner.query(`CREATE TABLE IF NOT EXISTS storage_inventory_work (
   namespace varchar NOT NULL,kind varchar NOT NULL,path varchar NOT NULL,epoch varchar NOT NULL,identity varchar NOT NULL,
   cursor bigint NOT NULL DEFAULT 0 CHECK(cursor>=0),prefix varchar NOT NULL,state varchar NOT NULL DEFAULT 'pending',
   PRIMARY KEY(namespace,kind,path))`);
        await runner.query("CREATE INDEX IF NOT EXISTS storage_inventory_work_pending ON storage_inventory_work(namespace,kind,state,path)");
    }
    async down(runner: QueryRunner): Promise<void> {
        await runner.query("DROP TABLE IF EXISTS storage_inventory_work");
        await runner.query("DROP TABLE IF EXISTS storage_inventory_runs");
    }
}
