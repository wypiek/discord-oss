import { Column, Entity, Index } from "typeorm";
import { BaseClass } from "./BaseClass";

@Entity({
    name: "status_metrics",
})
@Index("IDX_status_metrics_bucket_at", ["bucket_at"])
export class StatusMetric extends BaseClass {
    @Column({ type: "timestamptz" })
    bucket_at: Date;

    @Column({ type: "integer" })
    requests: number;

    @Column({ type: "integer" })
    median_ms: number;
}
