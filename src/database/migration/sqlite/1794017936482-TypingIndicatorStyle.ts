import type { MigrationInterface, QueryRunner } from "typeorm";

const hasColumn = async (queryRunner: QueryRunner, table: string, name: string) => {
    const rows: { name: string }[] = await queryRunner.query(`PRAGMA table_info("${table}")`);
    return rows.some((row) => row.name === name);
};

export class TypingIndicatorStyle1794017936482 implements MigrationInterface {
    name = "TypingIndicatorStyle1794017936482";

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await hasColumn(queryRunner, "users", "typing_indicator_style"))) await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "typing_indicator_style" text`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await hasColumn(queryRunner, "users", "typing_indicator_style")) await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "typing_indicator_style"`);
    }
}
