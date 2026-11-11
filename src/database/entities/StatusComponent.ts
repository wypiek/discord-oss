import { Column, Entity } from "typeorm";
import { BaseClass } from "./BaseClass";

export type StatusComponentStatus = "operational" | "degraded_performance" | "partial_outage" | "major_outage" | "under_maintenance";

@Entity({
    name: "status_components",
})
export class StatusComponent extends BaseClass {
    @Column()
    name: string;

    @Column({ type: "text", nullable: true })
    description?: string | null;

    @Column({ type: "varchar", default: "operational" })
    status: StatusComponentStatus = "operational";

    @Column({ default: 0 })
    position: number = 0;

    @Column({ type: "timestamptz", default: () => "now()" })
    updated_at: Date = new Date();
}
