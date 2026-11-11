import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseClass } from "./BaseClass";
import { BlogCategory } from "./BlogCategory";

@Entity({
    name: "blog_posts",
})
@Index("IDX_blog_posts_published", ["published", "published_at"])
export class BlogPost extends BaseClass {
    @Column()
    title: string;

    @Index("IDX_blog_posts_slug", { unique: true })
    @Column()
    slug: string;

    @Column({ type: "text", default: "" })
    excerpt: string = "";

    @Column({ type: "text", default: "" })
    body: string = "";

    @Column({ type: "varchar", nullable: true })
    cover_image?: string | null;

    @Column({ type: "int8", nullable: true })
    category_id?: string | null;

    @JoinColumn({ name: "category_id", foreignKeyConstraintName: "FK_blog_posts_category_id" })
    @ManyToOne(() => BlogCategory, { onDelete: "SET NULL", nullable: true })
    category?: BlogCategory | null;

    @Column({ type: "varchar", default: "" })
    author_name: string = "";

    @Column({ default: false })
    published: boolean = false;

    @Column({ type: "timestamptz", nullable: true })
    published_at?: Date | null;

    @Column({ default: false })
    featured: boolean = false;

    @Column({ type: "timestamptz", default: () => "now()" })
    created_at: Date = new Date();

    @Column({ type: "timestamptz", default: () => "now()" })
    updated_at: Date = new Date();
}
