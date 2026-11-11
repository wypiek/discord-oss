import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseClass } from "./BaseClass";
import { HelpSection } from "./HelpSection";

@Entity({
    name: "help_articles",
})
export class HelpArticle extends BaseClass {
    @Index("IDX_help_articles_section_id")
    @Column({ type: "int8" })
    section_id: string;

    @JoinColumn({ name: "section_id", foreignKeyConstraintName: "FK_help_articles_section_id" })
    @ManyToOne(() => HelpSection, { onDelete: "CASCADE" })
    section?: HelpSection;

    @Column()
    title: string;

    @Index("IDX_help_articles_slug", { unique: true })
    @Column()
    slug: string;

    @Column({ type: "text", default: "" })
    body: string = "";

    @Column({ default: 0 })
    position: number = 0;

    @Column({ default: false })
    published: boolean = false;

    @Column({ default: false })
    promoted: boolean = false;

    @Column({ default: 0 })
    helpful_yes: number = 0;

    @Column({ default: 0 })
    helpful_no: number = 0;

    @Column({ type: "timestamptz", default: () => "now()" })
    created_at: Date = new Date();

    @Column({ type: "timestamptz", default: () => "now()" })
    updated_at: Date = new Date();
}
