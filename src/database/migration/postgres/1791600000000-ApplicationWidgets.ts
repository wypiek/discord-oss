import { MigrationInterface, QueryRunner } from "typeorm";

export class ApplicationWidgets1791600000000 implements MigrationInterface {
    name = "ApplicationWidgets1791600000000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "applications" ADD "widget_config" jsonb`);
        await queryRunner.query(`ALTER TABLE "applications" ADD "widget_public" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(
            `CREATE TABLE "application_identities" ("application_id" bigint NOT NULL, "user_id" bigint NOT NULL, "username" character varying, "data" jsonb NOT NULL DEFAULT '{}', "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_application_identities" PRIMARY KEY ("application_id", "user_id"))`,
        );
        await queryRunner.query(`CREATE INDEX "IDX_application_identities_user_id" ON "application_identities" ("user_id")`);
        await queryRunner.query(
            `ALTER TABLE "application_identities" ADD CONSTRAINT "FK_application_identity_application_id" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
        );
        await queryRunner.query(
            `ALTER TABLE "application_identities" ADD CONSTRAINT "FK_application_identity_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "application_identities"`);
        await queryRunner.query(`ALTER TABLE "applications" DROP COLUMN "widget_public"`);
        await queryRunner.query(`ALTER TABLE "applications" DROP COLUMN "widget_config"`);
    }
}
