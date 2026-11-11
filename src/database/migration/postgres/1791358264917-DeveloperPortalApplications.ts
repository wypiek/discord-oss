import { MigrationInterface, QueryRunner } from "typeorm";

export class DeveloperPortalApplications1791358264917 implements MigrationInterface {
    name = "DeveloperPortalApplications1791358264917";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "assets" jsonb NOT NULL DEFAULT '[]'`);
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "application_testers" ("application_id" bigint NOT NULL, "user_id" bigint NOT NULL, "state" integer NOT NULL DEFAULT 2, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_application_testers" PRIMARY KEY ("application_id", "user_id"), CONSTRAINT "FK_application_tester_application_id" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_application_tester_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
        );
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_application_testers_user_id" ON "application_testers" ("user_id")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "application_testers"`);
        await queryRunner.query(`ALTER TABLE "applications" DROP COLUMN IF EXISTS "assets"`);
    }
}
