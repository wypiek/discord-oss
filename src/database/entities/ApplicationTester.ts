import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { BaseClassWithoutId } from "./BaseClass";
import { Application } from "./Application";
import { User } from "./User";

export enum ApplicationTesterState {
    INVITED = 1,
    ACCEPTED = 2,
}

@Entity({ name: "application_testers" })
export class ApplicationTester extends BaseClassWithoutId {
    @PrimaryColumn({ type: "int8" })
    application_id: string;

    @JoinColumn({
        name: "application_id",
        foreignKeyConstraintName: "FK_application_tester_application_id",
    })
    @ManyToOne(() => Application, { onDelete: "CASCADE" })
    application: Application;

    @PrimaryColumn({ type: "int8" })
    @Index("IDX_application_testers_user_id")
    user_id: string;

    @JoinColumn({ name: "user_id", foreignKeyConstraintName: "FK_application_tester_user_id" })
    @ManyToOne(() => User, { onDelete: "CASCADE" })
    user: User;

    @Column({ type: "int", default: ApplicationTesterState.ACCEPTED })
    state: ApplicationTesterState;

    @Column({ type: "timestamp with time zone", default: () => "now()" })
    created_at: Date;
}
