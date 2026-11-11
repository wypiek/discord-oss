import type { MigrationInterface, QueryRunner } from "typeorm";

const hasColumn = async (queryRunner: QueryRunner, table: string, name: string) => {
    const rows: { name: string }[] = await queryRunner.query(`PRAGMA table_info("${table}")`);
    return rows.some((row) => row.name === name);
};

export class ScheduledMessageId1793152846317 implements MigrationInterface {
    name = "ScheduledMessageId1793152846317";

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await hasColumn(queryRunner, "scheduled_messages", "message_id"))) await queryRunner.query(`ALTER TABLE "scheduled_messages" ADD COLUMN "message_id" int8`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await hasColumn(queryRunner, "scheduled_messages", "message_id")) await queryRunner.query(`ALTER TABLE "scheduled_messages" DROP COLUMN "message_id"`);
    }
}
