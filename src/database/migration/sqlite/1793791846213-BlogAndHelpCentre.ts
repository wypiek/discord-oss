import type { MigrationInterface, QueryRunner } from "typeorm";
import { seedSiteContent } from "../SiteContentSeed";

const NOW = "(strftime('%Y-%m-%d %H:%M:%f', 'now'))";

export class BlogAndHelpCentre1793791846213 implements MigrationInterface {
    name = "BlogAndHelpCentre1793791846213";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "blog_categories" ("id" int8 PRIMARY KEY NOT NULL, "name" varchar NOT NULL, "slug" varchar NOT NULL, "description" text NOT NULL DEFAULT (''), "position" integer NOT NULL DEFAULT (0), "created_at" datetime NOT NULL DEFAULT ${NOW})`,
        );
        await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_blog_categories_slug" ON "blog_categories" ("slug")`);
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "blog_posts" ("id" int8 PRIMARY KEY NOT NULL, "title" varchar NOT NULL, "slug" varchar NOT NULL, "excerpt" text NOT NULL DEFAULT (''), "body" text NOT NULL DEFAULT (''), "cover_image" varchar, "category_id" int8, "author_name" varchar NOT NULL DEFAULT (''), "published" boolean NOT NULL DEFAULT (0), "published_at" datetime, "featured" boolean NOT NULL DEFAULT (0), "created_at" datetime NOT NULL DEFAULT ${NOW}, "updated_at" datetime NOT NULL DEFAULT ${NOW}, CONSTRAINT "FK_blog_posts_category_id" FOREIGN KEY ("category_id") REFERENCES "blog_categories" ("id") ON DELETE SET NULL)`,
        );
        await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_blog_posts_slug" ON "blog_posts" ("slug")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_blog_posts_published" ON "blog_posts" ("published", "published_at")`);
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "help_categories" ("id" int8 PRIMARY KEY NOT NULL, "name" varchar NOT NULL, "slug" varchar NOT NULL, "description" text NOT NULL DEFAULT (''), "icon" varchar NOT NULL DEFAULT (''), "icon_image" varchar, "position" integer NOT NULL DEFAULT (0))`,
        );
        await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_help_categories_slug" ON "help_categories" ("slug")`);
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "help_sections" ("id" int8 PRIMARY KEY NOT NULL, "category_id" int8 NOT NULL, "name" varchar NOT NULL, "position" integer NOT NULL DEFAULT (0), CONSTRAINT "FK_help_sections_category_id" FOREIGN KEY ("category_id") REFERENCES "help_categories" ("id") ON DELETE CASCADE)`,
        );
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_help_sections_category_id" ON "help_sections" ("category_id")`);
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "help_articles" ("id" int8 PRIMARY KEY NOT NULL, "section_id" int8 NOT NULL, "title" varchar NOT NULL, "slug" varchar NOT NULL, "body" text NOT NULL DEFAULT (''), "position" integer NOT NULL DEFAULT (0), "published" boolean NOT NULL DEFAULT (0), "promoted" boolean NOT NULL DEFAULT (0), "helpful_yes" integer NOT NULL DEFAULT (0), "helpful_no" integer NOT NULL DEFAULT (0), "created_at" datetime NOT NULL DEFAULT ${NOW}, "updated_at" datetime NOT NULL DEFAULT ${NOW}, CONSTRAINT "FK_help_articles_section_id" FOREIGN KEY ("section_id") REFERENCES "help_sections" ("id") ON DELETE CASCADE)`,
        );
        await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_help_articles_slug" ON "help_articles" ("slug")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_help_articles_section_id" ON "help_articles" ("section_id")`);
        await seedSiteContent(queryRunner, "sqlite");
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "help_articles"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "help_sections"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "help_categories"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "blog_posts"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "blog_categories"`);
    }
}
