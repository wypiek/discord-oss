import { BaseEntity, Column, Entity, PrimaryColumn } from "typeorm";
@Entity({ name: "storage_inventory_runs" })
export class StorageInventoryRun extends BaseEntity {
    @PrimaryColumn() namespace: string;
    @Column() epoch: string;
    @Column() root_identity: string;
    @Column() barrier_digest: string;
    @Column({ default: "running" }) state: string;
    @Column({ default: "content" }) phase: string;
    @Column({ nullable: true }) error_code: string;
    @Column({ type: "jsonb" }) policy: object;
    @Column({ type: "timestamp with time zone", default: () => "CURRENT_TIMESTAMP" })
    created_at: Date;
    @Column({ type: "timestamp with time zone", nullable: true }) completed_at: Date;
}
