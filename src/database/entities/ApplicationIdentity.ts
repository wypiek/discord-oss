import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { BaseClassWithoutId } from "./BaseClass";
import { Application } from "./Application";
import { User } from "./User";

// What an application knows about a user, shown in that application's profile widget.
@Entity({ name: "application_identities" })
export class ApplicationIdentity extends BaseClassWithoutId {
    @PrimaryColumn({ type: "int8" })
    application_id: string;

    @JoinColumn({
        name: "application_id",
        foreignKeyConstraintName: "FK_application_identity_application_id",
    })
    @ManyToOne(() => Application, { onDelete: "CASCADE" })
    application: Application;

    @PrimaryColumn({ type: "int8" })
    @Index("IDX_application_identities_user_id")
    user_id: string;

    @JoinColumn({ name: "user_id", foreignKeyConstraintName: "FK_application_identity_user_id" })
    @ManyToOne(() => User, { onDelete: "CASCADE" })
    user: User;

    @Column({ type: "varchar", nullable: true })
    username?: string | null;

    @Column({ type: "jsonb", default: {} })
    data: Record<string, string | number>;

    @Column({ type: "timestamp with time zone", default: () => "now()" })
    updated_at: Date;
}
