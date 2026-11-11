import { Column, Entity, PrimaryColumn } from "typeorm";
import { BaseClassWithoutId } from "./BaseClass";

@Entity({
    name: "connection_config",
})
export class ConnectionConfigEntity extends BaseClassWithoutId {
    @PrimaryColumn()
    key: string;

    @Column({ type: "simple-json", nullable: true })
    value: number | boolean | null | string | Date | undefined;
}
