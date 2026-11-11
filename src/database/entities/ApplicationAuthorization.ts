import { Column, Entity, JoinColumn, ManyToOne, Unique } from "typeorm";
import { BaseClass } from "./BaseClass";
import { User } from "./User";
import { Application } from "./Application";

@Entity({
    name: "application_authorizations",
})
@Unique("UQ_application_authorization_user_application", ["user", "application"])
export class ApplicationAuthorization extends BaseClass {
    @Column()
    user_id: string;

    @JoinColumn({ name: "user_id", foreignKeyConstraintName: "FK_application_authorization_user_id" })
    @ManyToOne(() => User, { onDelete: "CASCADE" })
    user: User;

    @Column()
    application_id: string;

    @JoinColumn({
        name: "application_id",
        foreignKeyConstraintName: "FK_application_authorization_application_id",
    })
    @ManyToOne(() => Application, { onDelete: "CASCADE" })
    application: Application;

    @Column({ type: "jsonb", default: [] })
    scopes: string[];

    @Column({ default: 1 })
    integration_type: number;

    @Column({ type: "timestamp with time zone", default: () => "now()" })
    created_at: Date;
}
