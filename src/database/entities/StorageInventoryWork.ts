import { BaseEntity, Column, Entity, PrimaryColumn } from "typeorm";
@Entity({ name: "storage_inventory_work" })
export class StorageInventoryWork extends BaseEntity {
    @PrimaryColumn() namespace: string;
    @PrimaryColumn() kind: string;
    @PrimaryColumn() path: string;
    @Column() epoch: string;
    @Column() identity: string;
    @Column({ type: "bigint", default: "0" }) cursor: string;
    @Column() prefix: string;
    @Column({ default: "pending" }) state: string;
}
