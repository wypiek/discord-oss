import { MigrationInterface, QueryRunner } from "typeorm";

export class MessageSoundboardSounds1791326581940 implements MigrationInterface {
    name = "MessageSoundboardSounds1791326581940";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "soundboard_sounds" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN IF EXISTS "soundboard_sounds"`);
    }
}
