import { Column, Entity, Index } from "typeorm";
import { BaseClass } from "./BaseClass";

@Entity({
    name: "help_categories",
})
export class HelpCategory extends BaseClass {
    @Column()
    name: string;

    @Index("IDX_help_categories_slug", { unique: true })
    @Column()
    slug: string;

    @Column({ type: "text", default: "" })
    description: string = "";

    @Column({ type: "varchar", default: "" })
    icon: string = "";

    @Column({ type: "varchar", nullable: true })
    icon_image?: string | null;

    @Column({ default: 0 })
    position: number = 0;
}
