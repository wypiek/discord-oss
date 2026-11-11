import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from "typeorm";
import { BaseClass } from "./BaseClass";
import { TeamMember } from "./TeamMember";
import { User } from "./User";

@Entity({
    name: "teams",
})
export class Team extends BaseClass {
    @Column({ nullable: true })
    icon?: string;

    @JoinColumn({ name: "member_ids", foreignKeyConstraintName: "FK_team_member_ids" })
    @OneToMany(
        () => TeamMember,
        (member: TeamMember) => member.team,
        {
            orphanedRowAction: "delete",
        },
    )
    members: TeamMember[];

    @Column()
    name: string;

    @Column({ nullable: true })
    owner_user_id: string;

    @JoinColumn({ name: "owner_user_id", foreignKeyConstraintName: "FK_team_owner_user_id" })
    @ManyToOne(() => User)
    owner_user: User;
}
