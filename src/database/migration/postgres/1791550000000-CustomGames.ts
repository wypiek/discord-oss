import { MigrationInterface, QueryRunner } from "typeorm";

export class CustomGames1791550000000 implements MigrationInterface {
    name = "CustomGames1791550000000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE "custom_games" ("id" bigint NOT NULL, "name" character varying NOT NULL, "aliases" jsonb NOT NULL DEFAULT '[]', "icon_hash" character varying, "cover_image_hash" character varying, "created_by" bigint, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_custom_games" PRIMARY KEY ("id"))`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "custom_games"`);
    }
}
