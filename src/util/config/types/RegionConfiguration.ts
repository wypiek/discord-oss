import { ConfigVoiceRegion } from "@spacebar/schemas";

export class RegionConfiguration {
    default: string = "spacebar";
    useDefaultAsOptimal: boolean = true;
    available: ConfigVoiceRegion[] = [
        {
            id: "spacebar",
            name: "spacebar",
            // the bundle serves voice on its own port under /voice unless WRTC_WS_PORT gives voice a separate one
            endpoint: process.env.WRTC_WS_PORT ? `127.0.0.1:${process.env.WRTC_WS_PORT}` : `127.0.0.1:${process.env.PORT || 3001}/voice`,
            vip: false,
            custom: false,
            deprecated: false,
        },
    ];
}
