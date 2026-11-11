export type InstanceUserDeleteSchema = InstanceUserDeleteSchemaContent | undefined; //unsure if this a correct way to make the body optional
export interface InstanceUserDeleteSchemaContent {
    /**
     * @maxLength 512
     */
    reason?: string;
    persistInstanceBan?: boolean;
}
