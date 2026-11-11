import { MigrationInterface, QueryRunner } from "typeorm";

export class SoundboardFavoriteOrder1791448273615 implements MigrationInterface {
    name = "SoundboardFavoriteOrder1791448273615";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `UPDATE "user_settings_protos"
            SET "frecencySettings" = jsonb_set("frecencySettings"::jsonb, '{favoriteSoundboardSounds,orderedSoundIds}', "frecencySettings"::jsonb #> '{favoriteSoundboardSounds,soundIds}')::text
            WHERE "frecencySettings" IS NOT NULL
                AND jsonb_typeof("frecencySettings"::jsonb #> '{favoriteSoundboardSounds,soundIds}') = 'array'
                AND jsonb_array_length("frecencySettings"::jsonb #> '{favoriteSoundboardSounds,soundIds}') > 0
                AND COALESCE(jsonb_array_length("frecencySettings"::jsonb #> '{favoriteSoundboardSounds,orderedSoundIds}'), 0) = 0`,
        );
    }

    public async down(): Promise<void> {}
}
