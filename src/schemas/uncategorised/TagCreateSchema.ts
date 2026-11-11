export interface TagCreateSchema {
    /**
     * @minLength 1
     * @maxLength 20
     */
    name: string;
    moderated?: boolean | null;
    /**
     * @maxLength 20
     */
    emoji_id?: string | null;
    /**
     * @maxLength 32
     */
    emoji_name?: string | null;
}
