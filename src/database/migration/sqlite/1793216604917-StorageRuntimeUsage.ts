import type { MigrationInterface, QueryRunner } from "typeorm";

const upsert = (row: "OLD" | "NEW", scope: "instance" | "principal" | "cache", sign: "" | "-") => {
    const key = scope === "principal" ? `${row}.budget_principal` : "''";
    const values = `${row}.namespace,'${scope}',${key},${sign}(${row}.bytes+${row}.reserved_bytes),${sign}1`;
    const source = scope === "cache" ? `SELECT ${values} WHERE ${row}.category='cache'` : `VALUES(${values})`;
    return `INSERT INTO storage_runtime_usage(namespace,scope,key,bytes,objects) ${source}
        ON CONFLICT(namespace,scope,key) DO UPDATE SET bytes=storage_runtime_usage.bytes+excluded.bytes,objects=storage_runtime_usage.objects+excluded.objects;`;
};
const apply = (row: "OLD" | "NEW", sign: "" | "-") => (["instance", "principal", "cache"] as const).map((scope) => upsert(row, scope, sign)).join("\n");

export class StorageRuntimeUsage1793216604917 implements MigrationInterface {
    name = "StorageRuntimeUsage1793216604917";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS storage_runtime_usage (namespace varchar(128) NOT NULL, scope varchar(16) NOT NULL, key varchar(128) NOT NULL DEFAULT '', bytes bigint NOT NULL DEFAULT 0, objects bigint NOT NULL DEFAULT 0, PRIMARY KEY(namespace,scope,key))`,
        );
        await queryRunner.query(`DROP TRIGGER IF EXISTS storage_runtime_usage_insert`);
        await queryRunner.query(`DROP TRIGGER IF EXISTS storage_runtime_usage_delete`);
        await queryRunner.query(`DROP TRIGGER IF EXISTS storage_runtime_usage_update`);
        await queryRunner.query(`CREATE TRIGGER storage_runtime_usage_insert AFTER INSERT ON storage_runtime_objects BEGIN\n${apply("NEW", "")}\nEND`);
        await queryRunner.query(`CREATE TRIGGER storage_runtime_usage_delete AFTER DELETE ON storage_runtime_objects BEGIN\n${apply("OLD", "-")}\nEND`);
        await queryRunner.query(
            `CREATE TRIGGER storage_runtime_usage_update AFTER UPDATE OF namespace,budget_principal,category,bytes,reserved_bytes ON storage_runtime_objects BEGIN\n${apply("OLD", "-")}\n${apply("NEW", "")}\nEND`,
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
        await queryRunner.query(`DROP TRIGGER IF EXISTS storage_runtime_usage_update`);
        await queryRunner.query(`DROP TRIGGER IF EXISTS storage_runtime_usage_delete`);
        await queryRunner.query(`DROP TRIGGER IF EXISTS storage_runtime_usage_insert`);
        await queryRunner.query(`DROP TABLE IF EXISTS storage_runtime_usage`);
    }
}
