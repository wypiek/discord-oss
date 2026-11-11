import { MigrationInterface, QueryRunner } from "typeorm";

export class AnnouncementTitleOptional1791530000000 implements MigrationInterface {
    name = "AnnouncementTitleOptional1791530000000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "announcements" ALTER COLUMN "title" DROP NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`UPDATE "announcements" SET "title" = '' WHERE "title" IS NULL`);
        await queryRunner.query(`ALTER TABLE "announcements" ALTER COLUMN "title" SET NOT NULL`);
    }
}
