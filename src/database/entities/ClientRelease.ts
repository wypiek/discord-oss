import { Column, Entity } from "typeorm";
import { BaseClass } from "./BaseClass";

@Entity({
    name: "client_release",
})
export class ClientRelease extends BaseClass {
    @Column()
    name: string;

    @Column()
    pub_date: Date;

    @Column()
    url: string;

    @Column()
    platform: string;

    @Column()
    enabled: boolean;

    @Column({ nullable: true })
    notes?: string;
}
