import type { MigrationInterface, QueryRunner } from "typeorm";

const NOW = "(strftime('%Y-%m-%d %H:%M:%f', 'now'))";

export class Changelogs1794015820347 implements MigrationInterface {
    name = "Changelogs1794015820347";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "changelogs" ("id" int8 PRIMARY KEY NOT NULL, "title" varchar NOT NULL DEFAULT (''), "date" varchar NOT NULL, "body" text NOT NULL DEFAULT (''), "image" varchar, "youtube_video_id" varchar, "published" boolean NOT NULL DEFAULT (0), "show_on_startup" boolean NOT NULL DEFAULT (1), "created_at" datetime NOT NULL DEFAULT ${NOW}, "updated_at" datetime NOT NULL DEFAULT ${NOW})`,
        );
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_changelogs_published" ON "changelogs" ("published", "date")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "changelogs"`);
    }
}
