export interface CdnEnv {
    MEDIA: R2Bucket;
    IMAGES?: ImagesBinding;
    ASSETS?: Fetcher;
    API?: Fetcher;
    CONFIG_JSON?: string;
    REQUEST_SIGNATURE?: string;
    CDN_SIGNATURE_KEY?: string;
    CDN_SIGN_URLS?: string;
    CDN_SIGNATURE_INCLUDE_IP?: string;
    CDN_SIGNATURE_INCLUDE_USER_AGENT?: string;
    CDN_ENDPOINT_PUBLIC?: string;
    CDN_UPSTREAM?: string;
}
