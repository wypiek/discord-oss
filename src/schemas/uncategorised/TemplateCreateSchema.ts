export interface TemplateCreateSchema {
    /**
     * @minLength 1
     * @maxLength 100
     */
    name: string;
    /**
     * @maxLength 120
     */
    description?: string;
}
