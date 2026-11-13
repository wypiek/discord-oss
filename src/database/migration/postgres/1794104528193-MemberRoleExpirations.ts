import type { MigrationInterface, QueryRunner } from "typeorm";

export class MemberRoleExpirations1794104528193 implements MigrationInterface {
    name = "MemberRoleExpirations1794104528193";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "member_role_expirations" ("guild_id" bigint NOT NULL, "user_id" bigint NOT NULL, "role_id" bigint NOT NULL, "member_index" integer NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "assigned_by" bigint, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_member_role_expirations" PRIMARY KEY ("guild_id", "user_id", "role_id"), CONSTRAINT "FK_member_role_expiration_guild_id" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_member_role_expiration_role_id" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_member_role_expiration_member_index" FOREIGN KEY ("member_index") REFERENCES "members"("index") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_member_role_expiration_member_role" FOREIGN KEY ("member_index", "role_id") REFERENCES "member_roles"("index", "role_id") ON DELETE CASCADE ON UPDATE CASCADE)`,
        );
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_member_role_expirations_expires_at" ON "member_role_expirations" ("expires_at")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_member_role_expirations_role_id" ON "member_role_expirations" ("role_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_member_role_expirations_member_index" ON "member_role_expirations" ("member_index")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "member_role_expirations"`);
    }
}
