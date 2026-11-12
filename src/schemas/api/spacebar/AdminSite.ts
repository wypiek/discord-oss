export interface AdminSiteOrderSchema {
    /**
     * @TJS-type array
     * @minItems 1
     * @maxItems 500
     * @items.type string
     * @items.maxLength 20
     */
    ids: string[];
}

export interface AdminSiteImageUploadSchema {
    /**
     * @minLength 1
     * @maxLength 10000000
     */
    image: string;
}

export interface AdminMarkdownPreviewSchema {
    /**
     * @maxLength 100000
     */
    markdown: string;
}

export interface AdminBlogCategoryCreateSchema {
    /**
     * @minLength 1
     * @maxLength 60
     */
    name: string;
    /**
     * @maxLength 80
     */
    slug?: string;
    /**
     * @maxLength 300
     */
    description?: string;
}

export interface AdminBlogCategoryUpdateSchema {
    /**
     * @minLength 1
     * @maxLength 60
     */
    name?: string;
    /**
     * @maxLength 80
     */
    slug?: string;
    /**
     * @maxLength 300
     */
    description?: string;
}

export interface AdminBlogPostCreateSchema {
    /**
     * @minLength 1
     * @maxLength 200
     */
    title: string;
    /**
     * @maxLength 80
     */
    slug?: string;
    /**
     * @maxLength 500
     */
    excerpt?: string;
    /**
     * @maxLength 100000
     */
    body?: string;
    /**
     * @maxLength 80
     */
    cover_image?: string | null;
    /**
     * @maxLength 20
     */
    category_id?: string | null;
    /**
     * @maxLength 80
     */
    author_name?: string;
    published?: boolean;
    /**
     * @maxLength 64
     */
    published_at?: string | null;
    featured?: boolean;
}

export type AdminBlogPostUpdateSchema = Partial<AdminBlogPostCreateSchema>;

export interface AdminChangelogCreateSchema {
    /**
     * @minLength 1
     * @maxLength 200
     */
    title: string;
    /**
     * @maxLength 10
     */
    date?: string;
    /**
     * @maxLength 100000
     */
    body?: string;
    /**
     * @maxLength 80
     */
    image?: string | null;
    /**
     * @maxLength 200
     */
    youtube_video_id?: string | null;
    published?: boolean;
    show_on_startup?: boolean;
}

export type AdminChangelogUpdateSchema = Partial<AdminChangelogCreateSchema>;

export interface AdminHelpCategoryCreateSchema {
    /**
     * @minLength 1
     * @maxLength 80
     */
    name: string;
    /**
     * @maxLength 80
     */
    slug?: string;
    /**
     * @maxLength 300
     */
    description?: string;
    /**
     * @maxLength 16
     */
    icon?: string;
    /**
     * @maxLength 80
     */
    icon_image?: string | null;
}

export type AdminHelpCategoryUpdateSchema = Partial<AdminHelpCategoryCreateSchema>;

export interface AdminHelpSectionCreateSchema {
    /**
     * @maxLength 20
     */
    category_id: string;
    /**
     * @minLength 1
     * @maxLength 120
     */
    name: string;
}

export type AdminHelpSectionUpdateSchema = Partial<AdminHelpSectionCreateSchema>;

export interface AdminHelpArticleCreateSchema {
    /**
     * @maxLength 20
     */
    section_id: string;
    /**
     * @minLength 1
     * @maxLength 200
     */
    title: string;
    /**
     * @maxLength 80
     */
    slug?: string;
    /**
     * @maxLength 100000
     */
    body?: string;
    published?: boolean;
    promoted?: boolean;
}

export type AdminHelpArticleUpdateSchema = Partial<AdminHelpArticleCreateSchema>;
