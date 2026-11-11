import { Column, Entity } from "typeorm";
import { BaseClass } from "./BaseClass";

// a staff announcement the official system account sent out from the admin panel
@Entity({
    name: "announcements",
})
export class Announcement extends BaseClass {
    // only announcements sent before they became plain messages have one
    @Column({ type: "character varying", nullable: true })
    title?: string | null;

    @Column({ type: "text" })
    body: string;

    @Column()
    audience: string; // "everyone" | "staff"

    @Column({ type: "int8", nullable: true })
    sent_by?: string | null;

    @Column({ type: "int", default: 0 })
    recipient_count: number = 0;

    @Column({ type: "int", default: 0 })
    attachment_count: number = 0;

    @Column({ type: "boolean", default: false })
    durable: boolean = false;

    @Column({ type: "timestamptz", default: () => "now()" })
    created_at: Date = new Date();
}
