import { Column, Entity, PrimaryColumn } from "typeorm";
import { BaseClassWithoutId } from "./BaseClass";

@Entity({
    name: "config",
})
export class ConfigEntity extends BaseClassWithoutId {
    @PrimaryColumn()
    key: string;

    @Column({ type: "simple-json", nullable: true })
    value: number | boolean | null | string | undefined | string[];
}
