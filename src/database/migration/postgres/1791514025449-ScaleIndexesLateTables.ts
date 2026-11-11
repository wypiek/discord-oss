import { MigrationInterface, QueryRunner } from "typeorm";
import { ScaleIndexes1791173948267 } from "./1791173948267-ScaleIndexes";

export class ScaleIndexesLateTables1791514025449 implements MigrationInterface {
    name = "ScaleIndexesLateTables1791514025449";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await new ScaleIndexes1791173948267().up(queryRunner);
    }

    public async down(): Promise<void> {}
}
