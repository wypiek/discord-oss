import type { CdnEnv } from "../../cdn/src/env";

export interface RouterEnv extends CdnEnv {
    ASSETS: Fetcher;
    API?: Fetcher;
    GATEWAY?: Fetcher;
    INSTANCE_NAME?: string;
    CLIENT_SETTINGS?: string;
    CLIENT_SETTINGS_PATH?: string;
}
