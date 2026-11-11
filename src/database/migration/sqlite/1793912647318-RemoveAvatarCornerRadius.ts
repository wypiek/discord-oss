import type { MigrationInterface, QueryRunner } from "typeorm";

const hasColumn = async (queryRunner: QueryRunner, table: string, name: string) => {
    const rows: { name: string }[] = await queryRunner.query(`PRAGMA table_info("${table}")`);
    return rows.some((row) => row.name === name);
};

export class RemoveAvatarCornerRadius1793912647318 implements MigrationInterface {
    name = "RemoveAvatarCornerRadius1793912647318";

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (await hasColumn(queryRunner, "users", "avatar_corner_radius")) await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "avatar_corner_radius"`);
    }

    public async down(): Promise<void> {}
}
