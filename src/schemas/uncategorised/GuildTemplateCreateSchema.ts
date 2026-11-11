export interface GuildTemplateCreateSchema {
    /**
     * @minLength 2
     * @maxLength 100
     */
    name: string;
    icon?: string | null;
}
