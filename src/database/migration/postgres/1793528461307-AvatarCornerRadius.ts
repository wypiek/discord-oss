import type { MigrationInterface, QueryRunner } from "typeorm";

export class AvatarCornerRadius1793528461307 implements MigrationInterface {
    name = "AvatarCornerRadius1793528461307";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_corner_radius" integer`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "avatar_corner_radius"`);
    }
}
