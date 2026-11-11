export interface BaseVoiceRegion {
    id: string;
    name: string;
    vip: boolean;
    custom: boolean;
    deprecated: boolean;
}

export interface ConfigVoiceRegion extends BaseVoiceRegion {
    endpoint: string; // not spec, used for config
    location?: {
        latitude: number;
        longitude: number;
    }; // not spec, used for config
    vip: boolean;
    custom: boolean;
    deprecated: boolean;
}

export interface VoiceRegionResponse extends BaseVoiceRegion {
    optimal: boolean;
}

export type VoiceRegionListResponse = VoiceRegionResponse[];
