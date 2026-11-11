import { Column, Entity, JoinColumn, ManyToOne } from "typeorm";
import { BaseClass } from "./BaseClass";
import { User } from "./User";
import { TeamMemberRole, TeamMemberState } from "@spacebar/schemas";

@Entity({
    name: "team_members",
})
export class TeamMember extends BaseClass {
    @Column({ type: "int" })
    membership_state: TeamMemberState;

    @Column({ type: "varchar", array: true })
    permissions: string[];

    @Column()
    role: TeamMemberRole;

    @Column({ nullable: true })
    team_id: string;

    @JoinColumn({ name: "team_id", foreignKeyConstraintName: "FK_team_member_team_id" })
    @ManyToOne(
        () => require("./Team").Team,
        (team: import("./Team").Team) => team.members,
        {
            onDelete: "CASCADE",
        },
    )
    team: import("./Team").Team;

    @Column({ nullable: true })
    user_id: string;

    @JoinColumn({ name: "user_id", foreignKeyConstraintName: "FK_team_member_user_id" })
    @ManyToOne(() => User, {
        onDelete: "CASCADE",
    })
    user: User;
}
