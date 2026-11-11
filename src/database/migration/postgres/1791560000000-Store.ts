import { MigrationInterface, QueryRunner } from "typeorm";

export class Store1791560000000 implements MigrationInterface {
    name = "Store1791560000000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE "store_packs" ("id" bigint NOT NULL, "name" character varying NOT NULL, "summary" text NOT NULL DEFAULT '', "banner_hash" character varying, "logo_hash" character varying, "position" integer NOT NULL DEFAULT 0, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_store_packs" PRIMARY KEY ("id"))`,
        );
        await queryRunner.query(
            `CREATE TABLE "store_items" ("id" bigint NOT NULL, "pack_id" bigint NOT NULL, "type" integer NOT NULL, "name" character varying NOT NULL, "summary" text NOT NULL DEFAULT '', "label" text NOT NULL DEFAULT '', "data" jsonb NOT NULL DEFAULT '{}', "position" integer NOT NULL DEFAULT 0, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_store_items" PRIMARY KEY ("id"))`,
        );
        await queryRunner.query(`CREATE INDEX "IDX_store_items_pack_id" ON "store_items" ("pack_id")`);
        await queryRunner.query(
            `ALTER TABLE "store_items" ADD CONSTRAINT "FK_store_items_pack_id" FOREIGN KEY ("pack_id") REFERENCES "store_packs"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
        );
        await queryRunner.query(`CREATE TABLE "store_hidden_packs" ("sku_id" bigint NOT NULL, CONSTRAINT "PK_store_hidden_packs" PRIMARY KEY ("sku_id"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "store_hidden_packs"`);
        await queryRunner.query(`DROP TABLE "store_items"`);
        await queryRunner.query(`DROP TABLE "store_packs"`);
    }
}
