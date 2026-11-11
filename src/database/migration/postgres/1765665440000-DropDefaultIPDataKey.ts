import { MigrationInterface, QueryRunner } from "typeorm";

export class DropDefaultIPDataKey1765665440000 implements MigrationInterface {
    name = "DropDefaultIPDataKey1765665440000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `UPDATE "config" SET "value" = NULL WHERE "key" = 'security_ipdataApiKey' AND octet_length("value") = $1 AND encode(sha256(convert_to("value", 'UTF8')), 'hex') = $2`,
            [58, "74ac9a79970ce47f44f7c502a83b98c9e4531b1d5daf14758780e97374421193"],
        );
    }

    public async down(_queryRunner: QueryRunner): Promise<void> {}
}
