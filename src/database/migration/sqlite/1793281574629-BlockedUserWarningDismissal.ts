import type { MigrationInterface, QueryRunner } from "typeorm";

const hasColumn = async (queryRunner: QueryRunner, table: string, name: string) => {
    const rows: { name: string }[] = await queryRunner.query(`PRAGMA table_info("${table}")`);
    return rows.some((row) => row.name === name);
};

export class BlockedUserWarningDismissal1793281574629 implements MigrationInterface {
    name = "BlockedUserWarningDismissal1793281574629";

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await hasColumn(queryRunner, "recipients", "blocked_user_warning_dismissed")))
            await queryRunner.query(`ALTER TABLE "recipients" ADD COLUMN "blocked_user_warning_dismissed" boolean NOT NULL DEFAULT (0)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await hasColumn(queryRunner, "recipients", "blocked_user_warning_dismissed"))
            await queryRunner.query(`ALTER TABLE "recipients" DROP COLUMN "blocked_user_warning_dismissed"`);
    }
}
