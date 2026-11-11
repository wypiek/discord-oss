import { BaseEntity, Column, Entity, PrimaryColumn } from "typeorm";

@Entity({ name: "storage_quota_objects" })
export class StorageQuotaObject extends BaseEntity {
    @PrimaryColumn() namespace: string;
    @PrimaryColumn() path: string;
    @Column() principal: string;
    @Column() category: string;
    @Column({ type: "bigint", default: "0" }) bytes: string;
    @Column() generation: string;
    @Column({ nullable: true }) pending_operation: string;
    @Column({ default: "reserved" }) state: string;
}
