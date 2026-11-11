// TODO: is there a better alternative for this?
import { JsonValue } from "@protobuf-ts/runtime";

export interface SettingsProtoResponse {
    settings: string;
}

export interface SettingsProtoUpdateResponse extends SettingsProtoResponse {
    out_of_date?: boolean;
}

export interface SettingsProtoJsonResponse {
    settings: JsonValue;
}

export interface SettingsProtoUpdateJsonResponse extends SettingsProtoJsonResponse {
    out_of_date?: boolean;
}

// TODO: these dont work with schemas validation
// Typed JSON schemas:
// export interface SettingsProtoUpdatePreloadedUserSettingsJsonResponse {
// 	settings: PreloadedUserSettings;
// 	out_of_date?: boolean;
// }
//
// export interface SettingsProtoUpdateFrecencyUserSettingsJsonResponse {
// 	settings: FrecencyUserSettings;
// 	out_of_date?: boolean;
// }

// TODO: what is this?
// export interface SettingsProtoUpdateTestSettingsJsonResponse {
// 	settings: {};
// 	out_of_date?: boolean;
// }
