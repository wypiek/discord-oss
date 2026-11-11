import type { MigrationInterface, QueryRunner } from "typeorm";

export class StorageRuntimeUsage1793216604917 implements MigrationInterface {
    name = "StorageRuntimeUsage1793216604917";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS storage_runtime_usage (namespace varchar(128) NOT NULL, scope varchar(16) NOT NULL, key varchar(128) NOT NULL DEFAULT '', bytes bigint NOT NULL DEFAULT 0, objects bigint NOT NULL DEFAULT 0, PRIMARY KEY(namespace,scope,key))`,
        );
        await queryRunner.query(`CREATE OR REPLACE FUNCTION storage_runtime_usage_add(usage_namespace varchar, usage_scope varchar, usage_key varchar, delta_bytes bigint, delta_objects bigint)
            RETURNS void LANGUAGE plpgsql AS $$
            BEGIN
                INSERT INTO storage_runtime_usage(namespace,scope,key,bytes,objects) VALUES(usage_namespace,usage_scope,usage_key,delta_bytes,delta_objects)
                ON CONFLICT(namespace,scope,key) DO UPDATE SET bytes=storage_runtime_usage.bytes+excluded.bytes,objects=storage_runtime_usage.objects+excluded.objects;
            END $$`);
        await queryRunner.query(`CREATE OR REPLACE FUNCTION storage_runtime_usage_sync() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP <> 'INSERT' THEN
                    PERFORM storage_runtime_usage_add(OLD.namespace,'instance','',-(OLD.bytes+OLD.reserved_bytes),-1);
                    PERFORM storage_runtime_usage_add(OLD.namespace,'principal',OLD.budget_principal,-(OLD.bytes+OLD.reserved_bytes),-1);
                    IF OLD.category = 'cache' THEN
                        PERFORM storage_runtime_usage_add(OLD.namespace,'cache','',-(OLD.bytes+OLD.reserved_bytes),-1);
                    END IF;
                END IF;
                IF TG_OP <> 'DELETE' THEN
                    PERFORM storage_runtime_usage_add(NEW.namespace,'instance','',NEW.bytes+NEW.reserved_bytes,1);
                    PERFORM storage_runtime_usage_add(NEW.namespace,'principal',NEW.budget_principal,NEW.bytes+NEW.reserved_bytes,1);
                    IF NEW.category = 'cache' THEN
                        PERFORM storage_runtime_usage_add(NEW.namespace,'cache','',NEW.bytes+NEW.reserved_bytes,1);
                    END IF;
                END IF;
                RETURN NULL;
            END $$`);
        if (queryRunner.isTransactionActive) await queryRunner.query(`LOCK TABLE storage_runtime_objects IN SHARE ROW EXCLUSIVE MODE`);
        await queryRunner.query(`DROP TRIGGER IF EXISTS storage_runtime_usage_sync ON storage_runtime_objects`);
        await queryRunner.query(
            `CREATE TRIGGER storage_runtime_usage_sync AFTER INSERT OR DELETE OR UPDATE OF namespace,budget_principal,category,bytes,reserved_bytes ON storage_runtime_objects FOR EACH ROW EXECUTE FUNCTION storage_runtime_usage_sync()`,
        );
        await queryRunner.query(`DELETE FROM storage_runtime_usage`);
        await queryRunner.query(
            `INSERT INTO storage_runtime_usage(namespace,scope,key,bytes,objects) SELECT namespace,'instance','',SUM(bytes+reserved_bytes),COUNT(*) FROM storage_runtime_objects GROUP BY namespace`,
        );
        await queryRunner.query(
            `INSERT INTO storage_runtime_usage(namespace,scope,key,bytes,objects) SELECT namespace,'principal',budget_principal,SUM(bytes+reserved_bytes),COUNT(*) FROM storage_runtime_objects GROUP BY namespace,budget_principal`,
        );
        await queryRunner.query(
            `INSERT INTO storage_runtime_usage(namespace,scope,key,bytes,objects) SELECT namespace,'cache','',SUM(bytes+reserved_bytes),COUNT(*) FROM storage_runtime_objects WHERE category='cache' GROUP BY namespace`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TRIGGER IF EXISTS storage_runtime_usage_sync ON storage_runtime_objects`);
        await queryRunner.query(`DROP FUNCTION IF EXISTS storage_runtime_usage_sync()`);
        await queryRunner.query(`DROP FUNCTION IF EXISTS storage_runtime_usage_add(varchar, varchar, varchar, bigint, bigint)`);
        await queryRunner.query(`DROP TABLE IF EXISTS storage_runtime_usage`);
    }
}
