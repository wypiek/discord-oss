import { Column, Entity } from "typeorm";
import { BaseClassWithoutId } from "./BaseClass";

@Entity({
    name: "badges",
})
export class Badge extends BaseClassWithoutId {
    @Column({ primary: true })
    id: string;

    @Column()
    description: string;

    @Column()
    icon: string;

    @Column({ nullable: true })
    link?: string;
}
