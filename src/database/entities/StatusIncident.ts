import { Column, Entity, Index } from "typeorm";
import { BaseClass } from "./BaseClass";

export type StatusIncidentImpact = "none" | "minor" | "major" | "critical" | "maintenance";
export type StatusIncidentState = "investigating" | "identified" | "monitoring" | "resolved" | "scheduled" | "in_progress" | "verifying" | "completed";

export const RESOLVED_INCIDENT_STATES: StatusIncidentState[] = ["resolved", "completed"];

export interface StatusIncidentUpdate {
    id: string;
    status: StatusIncidentState;
    body: string;
    created_at: string;
}

@Entity({
    name: "status_incidents",
})
export class StatusIncident extends BaseClass {
    @Column()
    name: string;

    @Column({ type: "varchar", default: "none" })
    impact: StatusIncidentImpact = "none";

    @Index("IDX_status_incident_status")
    @Column({ type: "varchar", default: "investigating" })
    status: StatusIncidentState = "investigating";

    @Column({ type: "jsonb", default: [] })
    updates: StatusIncidentUpdate[] = [];

    @Column({ type: "int8", array: true, default: [] })
    component_ids: string[] = [];

    // maintenance windows only
    @Column({ type: "timestamptz", nullable: true })
    scheduled_for?: Date | null;

    @Column({ type: "timestamptz", nullable: true })
    scheduled_until?: Date | null;

    @Column({ type: "timestamptz", default: () => "now()" })
    created_at: Date = new Date();

    @Column({ type: "timestamptz", default: () => "now()" })
    updated_at: Date = new Date();

    @Column({ type: "timestamptz", nullable: true })
    resolved_at?: Date | null;

    get is_maintenance() {
        return this.impact === "maintenance";
    }
}
