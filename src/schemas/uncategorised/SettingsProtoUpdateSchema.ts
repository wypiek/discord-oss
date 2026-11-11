// TODO: better alternative?
import { JsonValue } from "@protobuf-ts/runtime";

export interface SettingsProtoUpdateSchema {
    settings: string;
    required_data_version?: number;
}

export interface SettingsProtoUpdateJsonSchema {
    settings: JsonValue;
    required_data_version?: number;
}

// TODO: these dont work with schema validation
// typed JSON schemas:
// export interface SettingsProtoUpdatePreloadedUserSettingsSchema {
// 	settings: PreloadedUserSettings;
// 	required_data_version?: number;
// }
//
// export interface SettingsProtoUpdateFrecencyUserSettingsSchema {
// 	settings: FrecencyUserSettings;
// 	required_data_version?: number;
// }

// TODO: what is this?
// export interface SettingsProtoUpdateTestSettingsSchema {
// 	settings: {};
// 	required_data_version?: number;
// }
