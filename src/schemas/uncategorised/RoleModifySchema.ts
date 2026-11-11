export interface RoleModifySchema {
    /**
     * @maxLength 100
     */
    name?: string;
    /**
     * @maxLength 32
     */
    permissions?: string;
    color?: number;
    hoist?: boolean; // whether the role should be displayed separately in the sidebar
    mentionable?: boolean; // whether the role should be mentionable
    position?: number;
    icon?: string | null;
    /**
     * @maxLength 32
     */
    unicode_emoji?: string | null;
    colors?:
        | {
              primary_color: number;
              secondary_color?: number | null | undefined; // only used for "holographic" and "gradient" styles
              tertiary_color?: number | null | undefined; // only used for "holographic" style
          }
        | undefined;
}
