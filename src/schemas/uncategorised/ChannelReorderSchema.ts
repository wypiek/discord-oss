/**
 * @maxItems 5000
 */
export type ChannelReorderSchema = {
    /**
     * @maxLength 20
     */
    id: string;
    position?: number;
    lock_permissions?: boolean;
    /**
     * @maxLength 20
     */
    parent_id?: null | string;
}[];
