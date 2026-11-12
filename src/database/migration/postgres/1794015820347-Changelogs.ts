import type { MigrationInterface, QueryRunner } from "typeorm";

export class Changelogs1794015820347 implements MigrationInterface {
    name = "Changelogs1794015820347";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "changelogs" ("id" bigint NOT NULL, "title" character varying NOT NULL DEFAULT '', "date" character varying NOT NULL, "body" text NOT NULL DEFAULT '', "image" character varying, "youtube_video_id" character varying, "published" boolean NOT NULL DEFAULT false, "show_on_startup" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_changelogs" PRIMARY KEY ("id"))`,
        );
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_changelogs_published" ON "changelogs" ("published", "date")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "changelogs"`);
    }
}
