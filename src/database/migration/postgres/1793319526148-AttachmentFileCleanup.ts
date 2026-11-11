import type { MigrationInterface, QueryRunner } from "typeorm";

const idOf = (entry: string) => `CASE WHEN ${entry}->>'id' ~ '^[0-9]{1,19}$' AND (${entry}->>'id')::numeric <= 9223372036854775807 THEN (${entry}->>'id')::bigint END`;

const snapshotAttachmentIds = (
    snapshots: string,
) => `SELECT ${idOf("att")} FROM jsonb_array_elements(CASE WHEN jsonb_typeof(${snapshots}) = 'array' THEN ${snapshots} ELSE '[]'::jsonb END) snap
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(snap->'message'->'attachments') = 'array' THEN snap->'message'->'attachments' ELSE '[]'::jsonb END) att
`;

const reportAttachmentIds = (snapshot: string) =>
    `SELECT ${idOf("att")} FROM jsonb_array_elements(CASE WHEN jsonb_typeof(${snapshot}->'attachments') = 'array' THEN ${snapshot}->'attachments' ELSE '[]'::jsonb END) att`;

const holdFrom = (
    ids: string,
    holder: "holder_message_id" | "holder_report_id",
    holderId: string,
) => `INSERT INTO "attachment_holds" ("attachment_id", "channel_id", "message_id", "filename", "${holder}")
    SELECT DISTINCT ON (s.id) s.id, s.channel_id, s.message_id, s.filename, ${holderId} FROM (
        SELECT a."id" AS id, a."channel_id" AS channel_id, a."message_id" AS message_id, a."filename" AS filename FROM "attachments" a WHERE a."channel_id" IS NOT NULL AND a."id" IN (${ids})
        UNION ALL
        SELECT h."attachment_id", h."channel_id", h."message_id", h."filename" FROM "attachment_holds" h WHERE h."attachment_id" IN (${ids})
    ) s
    WHERE NOT EXISTS (SELECT 1 FROM "attachment_holds" e WHERE e."attachment_id" = s.id AND e."${holder}" = ${holderId})`;

export class AttachmentFileCleanup1793319526148 implements MigrationInterface {
    name = "AttachmentFileCleanup1793319526148";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "attachment_file_deletes" ("attachment_id" bigint PRIMARY KEY, "channel_id" bigint NOT NULL, "message_id" bigint, "filename" varchar NOT NULL, "created_at" timestamptz NOT NULL DEFAULT now())`,
        );
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_attachment_file_deletes_created_at" ON "attachment_file_deletes" ("created_at")`);
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "attachment_holds" ("attachment_id" bigint NOT NULL, "channel_id" bigint NOT NULL, "message_id" bigint, "filename" varchar NOT NULL,
            "holder_message_id" bigint REFERENCES "messages"("id") ON DELETE CASCADE, "holder_report_id" bigint REFERENCES "reports"("id") ON DELETE CASCADE, "created_at" timestamptz NOT NULL DEFAULT now())`,
        );
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_attachment_holds_attachment_id" ON "attachment_holds" ("attachment_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_attachment_holds_holder_message_id" ON "attachment_holds" ("holder_message_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_attachment_holds_holder_report_id" ON "attachment_holds" ("holder_report_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_attachment_holds_legacy_path" ON "attachment_holds" ("channel_id", "message_id")`);

        await queryRunner.query(
            `CREATE OR REPLACE FUNCTION "queue_attachment_file_delete"() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF OLD."channel_id" IS NOT NULL THEN
                    INSERT INTO "attachment_file_deletes" ("attachment_id", "channel_id", "message_id", "filename") VALUES (OLD."id", OLD."channel_id", OLD."message_id", OLD."filename") ON CONFLICT DO NOTHING;
                END IF;
                RETURN OLD;
            END $$`,
        );
        await queryRunner.query(
            `CREATE OR REPLACE FUNCTION "queue_held_attachment_file_delete"() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                INSERT INTO "attachment_file_deletes" ("attachment_id", "channel_id", "message_id", "filename") VALUES (OLD."attachment_id", OLD."channel_id", OLD."message_id", OLD."filename") ON CONFLICT DO NOTHING;
                RETURN OLD;
            END $$`,
        );
        await queryRunner.query(
            `CREATE OR REPLACE FUNCTION "hold_forwarded_attachments"() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                ${holdFrom(snapshotAttachmentIds(`NEW."message_snapshots"`), "holder_message_id", `NEW."id"`)};
                RETURN NULL;
            END $$`,
        );
        await queryRunner.query(
            `CREATE OR REPLACE FUNCTION "hold_reported_attachments"() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                ${holdFrom(reportAttachmentIds(`NEW."snapshot"`), "holder_report_id", `NEW."id"`)};
                RETURN NULL;
            END $$`,
        );

        await queryRunner.query(`DROP TRIGGER IF EXISTS "TRG_attachments_queue_file_delete" ON "attachments"`);
        await queryRunner.query(`CREATE TRIGGER "TRG_attachments_queue_file_delete" AFTER DELETE ON "attachments" FOR EACH ROW EXECUTE FUNCTION "queue_attachment_file_delete"()`);
        await queryRunner.query(`DROP TRIGGER IF EXISTS "TRG_attachment_holds_queue_file_delete" ON "attachment_holds"`);
        await queryRunner.query(
            `CREATE TRIGGER "TRG_attachment_holds_queue_file_delete" AFTER DELETE ON "attachment_holds" FOR EACH ROW EXECUTE FUNCTION "queue_held_attachment_file_delete"()`,
        );
        await queryRunner.query(`DROP TRIGGER IF EXISTS "TRG_messages_hold_forwarded_attachments" ON "messages"`);
        await queryRunner.query(
            `CREATE TRIGGER "TRG_messages_hold_forwarded_attachments" AFTER INSERT OR UPDATE OF "message_snapshots" ON "messages" FOR EACH ROW
            WHEN (jsonb_typeof(NEW."message_snapshots") = 'array' AND NEW."message_snapshots" <> '[]'::jsonb) EXECUTE FUNCTION "hold_forwarded_attachments"()`,
        );
        await queryRunner.query(`DROP TRIGGER IF EXISTS "TRG_reports_hold_reported_attachments" ON "reports"`);
        await queryRunner.query(
            `CREATE TRIGGER "TRG_reports_hold_reported_attachments" AFTER INSERT OR UPDATE OF "snapshot" ON "reports" FOR EACH ROW
            WHEN (jsonb_typeof(NEW."snapshot"->'attachments') = 'array') EXECUTE FUNCTION "hold_reported_attachments"()`,
        );

        await queryRunner.query(
            `INSERT INTO "attachment_holds" ("attachment_id", "channel_id", "message_id", "filename", "holder_message_id")
            SELECT DISTINCT a."id", a."channel_id", a."message_id", a."filename", m."id" FROM "messages" m
            CROSS JOIN LATERAL jsonb_array_elements(m."message_snapshots") snap
            CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(snap->'message'->'attachments') = 'array' THEN snap->'message'->'attachments' ELSE '[]'::jsonb END) att
            JOIN "attachments" a ON a."channel_id" IS NOT NULL AND a."id" = ${idOf("att")}
            WHERE jsonb_typeof(m."message_snapshots") = 'array' AND m."message_snapshots" <> '[]'::jsonb
            AND NOT EXISTS (SELECT 1 FROM "attachment_holds" e WHERE e."attachment_id" = a."id" AND e."holder_message_id" = m."id")`,
        );
        await queryRunner.query(
            `INSERT INTO "attachment_holds" ("attachment_id", "channel_id", "message_id", "filename", "holder_report_id")
            SELECT DISTINCT a."id", a."channel_id", a."message_id", a."filename", r."id" FROM "reports" r
            CROSS JOIN LATERAL jsonb_array_elements(r."snapshot"->'attachments') att
            JOIN "attachments" a ON a."channel_id" IS NOT NULL AND a."id" = ${idOf("att")}
            WHERE jsonb_typeof(r."snapshot"->'attachments') = 'array'
            AND NOT EXISTS (SELECT 1 FROM "attachment_holds" e WHERE e."attachment_id" = a."id" AND e."holder_report_id" = r."id")`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TRIGGER IF EXISTS "TRG_reports_hold_reported_attachments" ON "reports"`);
        await queryRunner.query(`DROP TRIGGER IF EXISTS "TRG_messages_hold_forwarded_attachments" ON "messages"`);
        await queryRunner.query(`DROP TRIGGER IF EXISTS "TRG_attachment_holds_queue_file_delete" ON "attachment_holds"`);
        await queryRunner.query(`DROP TRIGGER IF EXISTS "TRG_attachments_queue_file_delete" ON "attachments"`);
        await queryRunner.query(`DROP FUNCTION IF EXISTS "hold_reported_attachments"()`);
        await queryRunner.query(`DROP FUNCTION IF EXISTS "hold_forwarded_attachments"()`);
        await queryRunner.query(`DROP FUNCTION IF EXISTS "queue_held_attachment_file_delete"()`);
        await queryRunner.query(`DROP FUNCTION IF EXISTS "queue_attachment_file_delete"()`);
        await queryRunner.query(`DROP TABLE IF EXISTS "attachment_holds"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "attachment_file_deletes"`);
    }
}
