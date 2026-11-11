import type { MigrationInterface, QueryRunner } from "typeorm";
import { seedSiteContent } from "../SiteContentSeed";

export class BlogAndHelpCentre1793791846213 implements MigrationInterface {
    name = "BlogAndHelpCentre1793791846213";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "blog_categories" ("id" bigint NOT NULL, "name" character varying NOT NULL, "slug" character varying NOT NULL, "description" text NOT NULL DEFAULT '', "position" integer NOT NULL DEFAULT 0, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_blog_categories" PRIMARY KEY ("id"))`,
        );
        await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_blog_categories_slug" ON "blog_categories" ("slug")`);
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "blog_posts" ("id" bigint NOT NULL, "title" character varying NOT NULL, "slug" character varying NOT NULL, "excerpt" text NOT NULL DEFAULT '', "body" text NOT NULL DEFAULT '', "cover_image" character varying, "category_id" bigint, "author_name" character varying NOT NULL DEFAULT '', "published" boolean NOT NULL DEFAULT false, "published_at" TIMESTAMP WITH TIME ZONE, "featured" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_blog_posts" PRIMARY KEY ("id"), CONSTRAINT "FK_blog_posts_category_id" FOREIGN KEY ("category_id") REFERENCES "blog_categories"("id") ON DELETE SET NULL)`,
        );
        await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_blog_posts_slug" ON "blog_posts" ("slug")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_blog_posts_published" ON "blog_posts" ("published", "published_at")`);
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "help_categories" ("id" bigint NOT NULL, "name" character varying NOT NULL, "slug" character varying NOT NULL, "description" text NOT NULL DEFAULT '', "icon" character varying NOT NULL DEFAULT '', "icon_image" character varying, "position" integer NOT NULL DEFAULT 0, CONSTRAINT "PK_help_categories" PRIMARY KEY ("id"))`,
        );
        await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_help_categories_slug" ON "help_categories" ("slug")`);
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "help_sections" ("id" bigint NOT NULL, "category_id" bigint NOT NULL, "name" character varying NOT NULL, "position" integer NOT NULL DEFAULT 0, CONSTRAINT "PK_help_sections" PRIMARY KEY ("id"), CONSTRAINT "FK_help_sections_category_id" FOREIGN KEY ("category_id") REFERENCES "help_categories"("id") ON DELETE CASCADE)`,
        );
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_help_sections_category_id" ON "help_sections" ("category_id")`);
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "help_articles" ("id" bigint NOT NULL, "section_id" bigint NOT NULL, "title" character varying NOT NULL, "slug" character varying NOT NULL, "body" text NOT NULL DEFAULT '', "position" integer NOT NULL DEFAULT 0, "published" boolean NOT NULL DEFAULT false, "promoted" boolean NOT NULL DEFAULT false, "helpful_yes" integer NOT NULL DEFAULT 0, "helpful_no" integer NOT NULL DEFAULT 0, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_help_articles" PRIMARY KEY ("id"), CONSTRAINT "FK_help_articles_section_id" FOREIGN KEY ("section_id") REFERENCES "help_sections"("id") ON DELETE CASCADE)`,
        );
        await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_help_articles_slug" ON "help_articles" ("slug")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_help_articles_section_id" ON "help_articles" ("section_id")`);
        await seedSiteContent(queryRunner, "postgres");
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "help_articles"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "help_sections"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "help_categories"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "blog_posts"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "blog_categories"`);
    }
}
