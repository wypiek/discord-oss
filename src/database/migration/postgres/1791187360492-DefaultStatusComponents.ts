import { MigrationInterface, QueryRunner } from "typeorm";

const COMPONENTS = [
    {
        name: "API",
        description: "Signing in, sending messages and everything else the app asks the server for.",
    },
    {
        name: "Gateway",
        description: "The live connection that delivers new messages, typing and presence.",
    },
    { name: "Media Proxy", description: "Attachments, avatars, emoji and embedded images." },
    { name: "Push Notifications", description: null },
    { name: "Search", description: null },
    { name: "Voice", description: "Voice and video calls, screen sharing and Stage channels." },
];

export class DefaultStatusComponents1791187360492 implements MigrationInterface {
    name = "DefaultStatusComponents1791187360492";

    public async up(queryRunner: QueryRunner): Promise<void> {
        const [{ count }] = await queryRunner.query(`SELECT count(*)::int AS "count" FROM "status_components"`);
        if (count > 0) return;
        for (const [position, component] of COMPONENTS.entries())
            await queryRunner.query(
                `INSERT INTO "status_components" ("id", "name", "description", "status", "position") VALUES (((floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint - 1420070400000) << 22) + $1::bigint, $2, $3, 'operational', $4)`,
                [position, component.name, component.description, position],
            );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DELETE FROM "status_components" WHERE "name" = ANY($1)`, [COMPONENTS.map((component) => component.name)]);
    }
}
