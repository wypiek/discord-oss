import { MigrationInterface, QueryRunner } from "typeorm";

export class StoreSelectionDeletion1791807003271 implements MigrationInterface {
    name = "StoreSelectionDeletion1791807003271";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "store_item_deletions" ("sku_id" character varying(20) PRIMARY KEY, "deleted_at" timestamptz NOT NULL DEFAULT now())`);
        await queryRunner.query(`CREATE OR REPLACE FUNCTION "sanitize_deleted_store_selections"() RETURNS trigger LANGUAGE plpgsql AS $body$
            BEGIN
                IF EXISTS (SELECT 1 FROM "store_item_deletions" WHERE sku_id = NEW.avatar_decoration_data ->> 'sku_id') THEN
                    NEW.avatar_decoration_data := NULL;
                END IF;
                IF EXISTS (SELECT 1 FROM "store_item_deletions" WHERE sku_id = NEW.collectibles -> 'nameplate' ->> 'sku_id') THEN
                    NEW.collectibles := jsonb_set(NEW.collectibles, '{nameplate}', 'null'::jsonb, false);
                END IF;
                IF jsonb_typeof(NEW.profile_collectibles) = 'array' THEN
                    SELECT COALESCE(jsonb_agg(entry ORDER BY position), '[]'::jsonb) INTO NEW.profile_collectibles
                    FROM jsonb_array_elements(NEW.profile_collectibles) WITH ORDINALITY AS entries(entry, position)
                    WHERE NOT EXISTS (SELECT 1 FROM "store_item_deletions" WHERE sku_id = entry ->> 'sku_id');
                END IF;
                RETURN NEW;
            END;
        $body$`);
        for (const table of ["users", "members"]) {
            await queryRunner.query(`DROP TRIGGER IF EXISTS "TR_${table}_store_selections" ON "${table}"`);
            await queryRunner.query(`CREATE TRIGGER "TR_${table}_store_selections" BEFORE INSERT OR UPDATE OF "avatar_decoration_data", "collectibles", "profile_collectibles"
                ON "${table}" FOR EACH ROW EXECUTE FUNCTION "sanitize_deleted_store_selections"()`);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const table of ["users", "members"]) await queryRunner.query(`DROP TRIGGER IF EXISTS "TR_${table}_store_selections" ON "${table}"`);
        await queryRunner.query(`DROP FUNCTION IF EXISTS "sanitize_deleted_store_selections"()`);
        await queryRunner.query(`DROP TABLE IF EXISTS "store_item_deletions"`);
    }
}
