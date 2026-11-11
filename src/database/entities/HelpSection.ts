import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseClass } from "./BaseClass";
import { HelpCategory } from "./HelpCategory";

@Entity({
    name: "help_sections",
})
export class HelpSection extends BaseClass {
    @Index("IDX_help_sections_category_id")
    @Column({ type: "int8" })
    category_id: string;

    @JoinColumn({ name: "category_id", foreignKeyConstraintName: "FK_help_sections_category_id" })
    @ManyToOne(() => HelpCategory, { onDelete: "CASCADE" })
    category?: HelpCategory;

    @Column()
    name: string;

    @Column({ default: 0 })
    position: number = 0;
}
