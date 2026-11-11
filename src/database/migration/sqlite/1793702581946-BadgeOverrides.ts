import type { MigrationInterface, QueryRunner } from "typeorm";

const hasColumn = async (queryRunner: QueryRunner, table: string, name: string) => {
    const rows: { name: string }[] = await queryRunner.query(`PRAGMA table_info("${table}")`);
    return rows.some((row) => row.name === name);
};

export class BadgeOverrides1793702581946 implements MigrationInterface {
    name = "BadgeOverrides1793702581946";

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await hasColumn(queryRunner, "users", "badge_overrides"))) await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "badge_overrides" text`);
        if (!(await hasColumn(queryRunner, "badges", "rarity"))) await queryRunner.query(`ALTER TABLE "badges" ADD COLUMN "rarity" integer`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await hasColumn(queryRunner, "badges", "rarity")) await queryRunner.query(`ALTER TABLE "badges" DROP COLUMN "rarity"`);
        if (await hasColumn(queryRunner, "users", "badge_overrides")) await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "badge_overrides"`);
    }
}
