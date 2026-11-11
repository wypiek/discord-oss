import { BaseClass } from "./BaseClass";
import { Entity, Column, CreateDateColumn } from "typeorm";
import { Embed } from "@spacebar/schemas";

@Entity({
    name: "embed_cache",
})
export class EmbedCache extends BaseClass {
    @Column()
    url: string;

    @Column({ type: "jsonb", nullable: true })
    embed?: Embed;

    @Column({ type: "jsonb", nullable: true })
    embeds?: Embed[];

    @CreateDateColumn({ name: "created_at", type: "timestamp with time zone" })
    createdAt: Date;
}
