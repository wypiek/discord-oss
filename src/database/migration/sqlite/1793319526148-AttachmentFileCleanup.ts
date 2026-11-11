import type { MigrationInterface, QueryRunner } from "typeorm";

const idOf = (entry: string) =>
    `CASE WHEN ${entry}.type = 'object' AND json_type(${entry}.value, '$.id') = 'text' AND json_extract(${entry}.value, '$.id') GLOB '[0-9]*' AND json_extract(${entry}.value, '$.id') NOT GLOB '*[^0-9]*' AND length(json_extract(${entry}.value, '$.id')) <= 19 THEN CAST(json_extract(${entry}.value, '$.id') AS integer) END`;

const snapshotAttachmentIds = (
    snapshots: string,
) => `SELECT ${idOf("att")} FROM json_each(CASE WHEN json_valid(${snapshots}) AND json_type(${snapshots}) = 'array' THEN ${snapshots} ELSE '[]' END) snap
    JOIN json_each(CASE WHEN snap.type = 'object' AND json_type(snap.value, '$.message.attachments') = 'array' THEN json_extract(snap.value, '$.message.attachments') ELSE '[]' END) att`;

const reportAttachmentIds = (snapshot: string) =>
    `SELECT ${idOf("att")} FROM json_each(CASE WHEN json_valid(${snapshot}) AND json_type(${snapshot}, '$.attachments') = 'array' THEN json_extract(${snapshot}, '$.attachments') ELSE '[]' END) att`;

const holdFrom = (
    ids: string,
    holder: "holder_message_id" | "holder_report_id",
    holderId: string,
) => `INSERT INTO "attachment_holds" ("attachment_id", "channel_id", "message_id", "filename", "${holder}")
    SELECT s.id, s.channel_id, s.message_id, s.filename, ${holderId} FROM (
        SELECT a."id" AS id, a."channel_id" AS channel_id, a."message_id" AS message_id, a."filename" AS filename FROM "attachments" a WHERE a."channel_id" IS NOT NULL AND a."id" IN (${ids})
        UNION ALL
        SELECT h."attachment_id", h."channel_id", h."message_id", h."filename" FROM "attachment_holds" h WHERE h."attachment_id" IN (${ids})
    ) s
    WHERE NOT EXISTS (SELECT 1 FROM "attachment_holds" e WHERE e."attachment_id" = s.id AND e."${holder}" = ${holderId})
    GROUP BY s.id`;

const FORWARDED = `json_valid(NEW."message_snapshots") AND json_type(NEW."message_snapshots") = 'array' AND NEW."message_snapshots" <> '[]'`;
const REPORTED = `json_valid(NEW."snapshot") AND json_type(NEW."snapshot", '$.attachments') = 'array'`;

export class AttachmentFileCleanup1793319526148 implements MigrationInterface {
    name = "AttachmentFileCleanup1793319526148";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "attachment_file_deletes" ("attachment_id" bigint PRIMARY KEY NOT NULL, "channel_id" bigint NOT NULL, "message_id" bigint, "filename" varchar NOT NULL, "created_at" datetime NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')))`,
        );
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_attachment_file_deletes_created_at" ON "attachment_file_deletes" ("created_at")`);
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "attachment_holds" ("attachment_id" bigint NOT NULL, "channel_id" bigint NOT NULL, "message_id" bigint, "filename" varchar NOT NULL,
            "holder_message_id" bigint REFERENCES "messages"("id") ON DELETE CASCADE, "holder_report_id" bigint REFERENCES "reports"("id") ON DELETE CASCADE, "created_at" datetime NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')))`,
        );
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_attachment_holds_attachment_id" ON "attachment_holds" ("attachment_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_attachment_holds_holder_message_id" ON "attachment_holds" ("holder_message_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_attachment_holds_holder_report_id" ON "attachment_holds" ("holder_report_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_attachment_holds_legacy_path" ON "attachment_holds" ("channel_id", "message_id")`);

        await queryRunner.query(
            `CREATE TRIGGER IF NOT EXISTS "TRG_attachments_queue_file_delete" AFTER DELETE ON "attachments" WHEN OLD."channel_id" IS NOT NULL BEGIN
            INSERT INTO "attachment_file_deletes" ("attachment_id", "channel_id", "message_id", "filename") VALUES (OLD."id", OLD."channel_id", OLD."message_id", OLD."filename") ON CONFLICT DO NOTHING; END`,
        );
        await queryRunner.query(
            `CREATE TRIGGER IF NOT EXISTS "TRG_attachment_holds_queue_file_delete" AFTER DELETE ON "attachment_holds" BEGIN
            INSERT INTO "attachment_file_deletes" ("attachment_id", "channel_id", "message_id", "filename") VALUES (OLD."attachment_id", OLD."channel_id", OLD."message_id", OLD."filename") ON CONFLICT DO NOTHING; END`,
        );
        for (const [name, event] of [
            ["TRG_messages_hold_forwarded_attachments", "INSERT"],
            ["TRG_messages_hold_forwarded_attachments_update", `UPDATE OF "message_snapshots"`],
        ])
            await queryRunner.query(
                `CREATE TRIGGER IF NOT EXISTS "${name}" AFTER ${event} ON "messages" WHEN ${FORWARDED} BEGIN ${holdFrom(snapshotAttachmentIds(`NEW."message_snapshots"`), "holder_message_id", `NEW."id"`)}; END`,
            );
        for (const [name, event] of [
            ["TRG_reports_hold_reported_attachments", "INSERT"],
            ["TRG_reports_hold_reported_attachments_update", `UPDATE OF "snapshot"`],
        ])
            await queryRunner.query(
                `CREATE TRIGGER IF NOT EXISTS "${name}" AFTER ${event} ON "reports" WHEN ${REPORTED} BEGIN ${holdFrom(reportAttachmentIds(`NEW."snapshot"`), "holder_report_id", `NEW."id"`)}; END`,
            );

        await queryRunner.query(
            `INSERT INTO "attachment_holds" ("attachment_id", "channel_id", "message_id", "filename", "holder_message_id")
            SELECT DISTINCT a."id", a."channel_id", a."message_id", a."filename", m."id" FROM "messages" m
            JOIN json_each(CASE WHEN json_valid(m."message_snapshots") AND json_type(m."message_snapshots") = 'array' THEN m."message_snapshots" ELSE '[]' END) snap
            JOIN json_each(CASE WHEN snap.type = 'object' AND json_type(snap.value, '$.message.attachments') = 'array' THEN json_extract(snap.value, '$.message.attachments') ELSE '[]' END) att
            JOIN "attachments" a ON a."channel_id" IS NOT NULL AND a."id" = ${idOf("att")}
            WHERE m."message_snapshots" <> '[]'
            AND NOT EXISTS (SELECT 1 FROM "attachment_holds" e WHERE e."attachment_id" = a."id" AND e."holder_message_id" = m."id")`,
        );
        await queryRunner.query(
            `INSERT INTO "attachment_holds" ("attachment_id", "channel_id", "message_id", "filename", "holder_report_id")
            SELECT DISTINCT a."id", a."channel_id", a."message_id", a."filename", r."id" FROM "reports" r
            JOIN json_each(CASE WHEN json_valid(r."snapshot") AND json_type(r."snapshot", '$.attachments') = 'array' THEN json_extract(r."snapshot", '$.attachments') ELSE '[]' END) att
            JOIN "attachments" a ON a."channel_id" IS NOT NULL AND a."id" = ${idOf("att")}
            WHERE NOT EXISTS (SELECT 1 FROM "attachment_holds" e WHERE e."attachment_id" = a."id" AND e."holder_report_id" = r."id")`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const name of [
            "TRG_reports_hold_reported_attachments_update",
            "TRG_reports_hold_reported_attachments",
            "TRG_messages_hold_forwarded_attachments_update",
            "TRG_messages_hold_forwarded_attachments",
            "TRG_attachment_holds_queue_file_delete",
            "TRG_attachments_queue_file_delete",
        ])
            await queryRunner.query(`DROP TRIGGER IF EXISTS "${name}"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "attachment_holds"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "attachment_file_deletes"`);
    }
}
