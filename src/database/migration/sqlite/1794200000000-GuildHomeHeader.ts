import type { MigrationInterface, QueryRunner } from "typeorm";

const hasColumn = async (queryRunner: QueryRunner, table: string, name: string) => {
    const rows: { name: string }[] = await queryRunner.query(`PRAGMA table_info("${table}")`);
    return rows.some((row) => row.name === name);
};

export class GuildHomeHeader1794200000000 implements MigrationInterface {
    name = "GuildHomeHeader1794200000000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await hasColumn(queryRunner, "guilds", "home_header"))) await queryRunner.query(`ALTER TABLE "guilds" ADD COLUMN "home_header" varchar`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await hasColumn(queryRunner, "guilds", "home_header")) await queryRunner.query(`ALTER TABLE "guilds" DROP COLUMN "home_header"`);
    }
}
