import { Column, Entity, JoinColumn, ManyToOne, Unique } from "typeorm";
import { BaseClass } from "./BaseClass";
import { User } from "./User";

@Entity({
    name: "notes",
})
@Unique(["owner", "target"])
export class Note extends BaseClass {
    @JoinColumn({ name: "owner_id", foreignKeyConstraintName: "FK_note_owner_id" })
    @ManyToOne(() => User, { onDelete: "CASCADE" })
    owner: User;

    @JoinColumn({ name: "target_id", foreignKeyConstraintName: "FK_note_target_id" })
    @ManyToOne(() => User, { onDelete: "CASCADE" })
    target: User;

    @Column()
    content: string;
}
