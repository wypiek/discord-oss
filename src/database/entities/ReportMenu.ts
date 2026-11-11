import { BaseClass } from "./BaseClass";
import { Entity, Column } from "typeorm";
import { ReportMenuType } from "@spacebar/schemas/api/reports/ReportMenu";

@Entity({
    name: "report_menus",
})
export class ReportMenu extends BaseClass {
    @Column()
    type: ReportMenuType;

    @Column()
    variant: string;

    @Column()
    isCurrent: boolean;

    @Column({ nullable: true })
    inherits?: string;

    @Column({ type: "jsonb" })
    content: unknown;
}
