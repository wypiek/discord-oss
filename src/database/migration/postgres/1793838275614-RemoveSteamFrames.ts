import type { MigrationInterface, QueryRunner } from "typeorm";

const STEAM_SKU = "'^800000000[0-9]{10}$'";
const FIRST_STEAM_SKU = "8000000000000000000";
const LAST_STEAM_SKU = "8000000009999999999";

export class RemoveSteamFrames1793838275614 implements MigrationInterface {
    name = "RemoveSteamFrames1793838275614";

    public async up(queryRunner: QueryRunner): Promise<void> {
        for (const table of ["users", "members"])
            await queryRunner.query(`UPDATE "${table}" SET "avatar_decoration_data" = NULL WHERE "avatar_decoration_data" ->> 'sku_id' ~ ${STEAM_SKU}`);
        await queryRunner.query(`DELETE FROM "collectible_purchases" WHERE "sku_id" BETWEEN ${FIRST_STEAM_SKU} AND ${LAST_STEAM_SKU}`);
        await queryRunner.query(`DELETE FROM "store_hidden_packs" WHERE "sku_id" BETWEEN ${FIRST_STEAM_SKU} AND ${LAST_STEAM_SKU}`);
        await queryRunner.query(`DELETE FROM "config" WHERE "key" = 'externalRequests_steamAssetFallback'`);
    }

    public async down(): Promise<void> {}
}
