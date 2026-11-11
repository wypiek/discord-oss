import type { MigrationInterface, QueryRunner } from "typeorm";

const hasColumn = async (queryRunner: QueryRunner, table: string, name: string) => {
    const rows: { name: string }[] = await queryRunner.query(`PRAGMA table_info("${table}")`);
    return rows.some((row) => row.name === name);
};

export class CompletedNewMemberActions1793283916457 implements MigrationInterface {
    name = "CompletedNewMemberActions1793283916457";

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await hasColumn(queryRunner, "members", "completed_new_member_actions")))
            await queryRunner.query(`ALTER TABLE "members" ADD COLUMN "completed_new_member_actions" text`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await hasColumn(queryRunner, "members", "completed_new_member_actions")) await queryRunner.query(`ALTER TABLE "members" DROP COLUMN "completed_new_member_actions"`);
    }
}
