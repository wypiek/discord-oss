export interface ApplicationCreateSchema {
    /**
     * @minLength 2
     * @maxLength 32
     */
    name: string;
    /**
     * @maxLength 20
     */
    team_id?: string;
}
