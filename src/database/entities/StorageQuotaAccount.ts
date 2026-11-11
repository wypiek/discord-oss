import { BaseEntity, Column, Entity, PrimaryColumn } from "typeorm";

@Entity({ name: "storage_quota_accounts" })
export class StorageQuotaAccount extends BaseEntity {
    @PrimaryColumn() namespace: string;
    @PrimaryColumn() key: string;
    @Column({ type: "bigint", default: "0" }) used_bytes: string;
    @Column({ type: "bigint", default: "0" }) reserved_bytes: string;
    @Column({ type: "bigint", default: "0" }) used_objects: string;
    @Column({ type: "bigint", default: "0" }) reserved_objects: string;
    @Column({ default: "inventory-required" }) state: string;
}
