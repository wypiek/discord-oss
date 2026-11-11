import type { MigrationInterface, QueryRunner } from "typeorm";

export class StrayMemberRoles1793062718391 implements MigrationInterface {
    name = "StrayMemberRoles1793062718391";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DELETE FROM "member_roles" WHERE EXISTS (SELECT 1 FROM "members" m JOIN "roles" r ON r."id" = "member_roles"."role_id" WHERE m."index" = "member_roles"."index" AND r."guild_id" <> m."guild_id")`,
        );
        await queryRunner.query(
            `DELETE FROM "member_roles" WHERE EXISTS (SELECT 1 FROM "members" m JOIN "roles" r ON r."id" = "member_roles"."role_id" JOIN "users" u ON u."id" = m."id" WHERE m."index" = "member_roles"."index" AND r."managed" = 1 AND u."bot" = 0)`,
        );
    }

    public async down(): Promise<void> {}
}
