import { BaseEntity, Column, Entity, PrimaryColumn } from "typeorm";

@Entity({ name: "storage_quota_operations" })
export class StorageQuotaOperation extends BaseEntity {
    @PrimaryColumn() namespace: string;
    @PrimaryColumn() id: string;
    @Column() path: string;
    @Column() principal: string;
    @Column() category: string;
    @Column({ type: "bigint" }) upper_bytes: string;
    @Column({ type: "bigint" }) prior_bytes: string;
    @Column({ type: "boolean" }) prior_exists: boolean;
    @Column() prior_generation: string;
    @Column({ default: "reserved" }) state: string;
    @Column({ type: "bigint", nullable: true }) actual_bytes: string;
    @Column({ type: "timestamp with time zone", default: () => "CURRENT_TIMESTAMP" })
    created_at: Date;
}
