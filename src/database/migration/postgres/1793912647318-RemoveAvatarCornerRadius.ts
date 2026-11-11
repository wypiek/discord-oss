import type { MigrationInterface, QueryRunner } from "typeorm";

export class RemoveAvatarCornerRadius1793912647318 implements MigrationInterface {
    name = "RemoveAvatarCornerRadius1793912647318";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "avatar_corner_radius"`);
    }

    public async down(): Promise<void> {}
}
