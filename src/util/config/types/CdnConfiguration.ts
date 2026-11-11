import { EndpointConfiguration } from "./EndpointConfiguration";

export class CdnConfiguration extends EndpointConfiguration {
    resizeHeightMax: number = 1000;
    resizeWidthMax: number = 1000;
    imagorServerUrl: string | null = null;
    proxyCacheHeaderSeconds: number = 60 * 60 * 24;
    maxAttachmentSize: number = 500 * 1024 * 1024;
    uploadDeadlineSeconds: number = 60;
    storageQuota: StorageQuotaConfiguration = new StorageQuotaConfiguration();
}

export class StorageQuotaConfiguration {
    instanceBytes: number = 100 * 1024 * 1024 * 1024;
    principalBytes: number = 10 * 1024 * 1024 * 1024;
    cacheBytes: number = 1024 * 1024 * 1024;
    instanceObjects: number = 100000;
    principalObjects: number = 10000;
    cacheObjects: number = 10000;
}
