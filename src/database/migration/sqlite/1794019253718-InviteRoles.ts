import type { MigrationInterface, QueryRunner } from "typeorm";

const hasColumn = async (queryRunner: QueryRunner, table: string, name: string) => {
    const rows: { name: string }[] = await queryRunner.query(`PRAGMA table_info("${table}")`);
    return rows.some((row) => row.name === name);
};

export class InviteRoles1794019253718 implements MigrationInterface {
    name = "InviteRoles1794019253718";

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await hasColumn(queryRunner, "invites", "role_ids"))) await queryRunner.query(`ALTER TABLE "invites" ADD COLUMN "role_ids" text`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await hasColumn(queryRunner, "invites", "role_ids")) await queryRunner.query(`ALTER TABLE "invites" DROP COLUMN "role_ids"`);
    }
}
