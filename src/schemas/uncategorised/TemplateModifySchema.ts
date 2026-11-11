export interface TemplateModifySchema {
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
