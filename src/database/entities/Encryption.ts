import { Column, Entity } from "typeorm";
import { BaseClass } from "./BaseClass";

@Entity({
    name: "security_settings",
})
export class SecuritySettings extends BaseClass {
    @Column({ type: "int8", nullable: true })
    guild_id: string;

    @Column({ type: "int8", nullable: true })
    channel_id: string;

    @Column()
    encryption_permission_mask: number;

    @Column({ type: "varchar", array: true })
    allowed_algorithms: string[];

    @Column()
    current_algorithm: string;

    @Column({ nullable: true })
    used_since_message: string;
}
