import { Column, Entity, Index } from "typeorm";
import { BaseClass } from "./BaseClass";

@Entity({
    name: "changelogs",
})
@Index("IDX_changelogs_published", ["published", "date"])
export class Changelog extends BaseClass {
    @Column({ type: "varchar", default: "" })
    title: string = "";

    @Column({ type: "varchar" })
    date: string;

    @Column({ type: "text", default: "" })
    body: string = "";

    @Column({ type: "varchar", nullable: true })
    image?: string | null;

    @Column({ type: "varchar", nullable: true })
    youtube_video_id?: string | null;

    @Column({ default: false })
    published: boolean = false;

    @Column({ default: true })
    show_on_startup: boolean = true;

    @Column({ type: "timestamptz", default: () => "now()" })
    created_at: Date = new Date();

    @Column({ type: "timestamptz", default: () => "now()" })
    updated_at: Date = new Date();
}
