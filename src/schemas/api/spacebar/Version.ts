export interface SpacebarVersionResponse {
    implementation: string;
    version: {
        rev: string | null;
        lastModified: number;
    };
}
