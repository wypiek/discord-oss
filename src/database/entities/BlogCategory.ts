import { Column, Entity, Index } from "typeorm";
import { BaseClass } from "./BaseClass";

@Entity({
    name: "blog_categories",
})
export class BlogCategory extends BaseClass {
    @Column()
    name: string;

    @Index("IDX_blog_categories_slug", { unique: true })
    @Column()
    slug: string;

    @Column({ type: "text", default: "" })
    description: string = "";

    @Column({ default: 0 })
    position: number = 0;

    @Column({ type: "timestamptz", default: () => "now()" })
    created_at: Date = new Date();
}
