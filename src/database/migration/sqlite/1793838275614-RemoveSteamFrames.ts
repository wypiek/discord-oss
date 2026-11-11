import type { MigrationInterface, QueryRunner } from "typeorm";

const DECORATION_SKU = `CASE WHEN NOT json_valid("avatar_decoration_data") THEN NULL WHEN json_type("avatar_decoration_data") = 'object' THEN json_extract("avatar_decoration_data", '$.sku_id') END`;

const isSteamSku = (value: string) => `CAST(${value} AS TEXT) GLOB '800000000${"[0-9]".repeat(10)}'`;

export class RemoveSteamFrames1793838275614 implements MigrationInterface {
    name = "RemoveSteamFrames1793838275614";

    public async up(queryRunner: QueryRunner): Promise<void> {
        for (const table of ["users", "members"]) await queryRunner.query(`UPDATE "${table}" SET "avatar_decoration_data" = NULL WHERE ${isSteamSku(DECORATION_SKU)}`);
        await queryRunner.query(`DELETE FROM "collectible_purchases" WHERE ${isSteamSku('"sku_id"')}`);
        await queryRunner.query(`DELETE FROM "store_hidden_packs" WHERE ${isSteamSku('"sku_id"')}`);
        await queryRunner.query(`DELETE FROM "config" WHERE "key" = 'externalRequests_steamAssetFallback'`);
    }

    public async down(): Promise<void> {}
}
