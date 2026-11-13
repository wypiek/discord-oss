import { Column, Entity, In, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { BaseClassWithoutId } from "./BaseClass";
import { Guild } from "./Guild";
import { Member } from "./Member";
import { Role } from "./Role";

export type RoleExpirationMap = Record<string, string>;

@Entity({ name: "member_role_expirations" })
export class MemberRoleExpiration extends BaseClassWithoutId {
    @PrimaryColumn({ type: "int8" })
    guild_id: string;

    @JoinColumn({ name: "guild_id", foreignKeyConstraintName: "FK_member_role_expiration_guild_id" })
    @ManyToOne(() => Guild, { onDelete: "CASCADE" })
    guild: Guild;

    @PrimaryColumn({ type: "int8" })
    user_id: string;

    @PrimaryColumn({ type: "int8" })
    @Index("IDX_member_role_expirations_role_id")
    role_id: string;

    @JoinColumn({ name: "role_id", foreignKeyConstraintName: "FK_member_role_expiration_role_id" })
    @ManyToOne(() => Role, { onDelete: "CASCADE" })
    role: Role;

    @Column({ type: "int" })
    @Index("IDX_member_role_expirations_member_index")
    member_index: number;

    @JoinColumn({ name: "member_index", foreignKeyConstraintName: "FK_member_role_expiration_member_index" })
    @ManyToOne(() => Member, { onDelete: "CASCADE" })
    member: Member;

    @Column({ type: "timestamp with time zone" })
    @Index("IDX_member_role_expirations_expires_at")
    expires_at: Date;

    @Column({ type: "int8", nullable: true })
    assigned_by: string | null;

    @Column({ type: "timestamp with time zone", default: () => "now()" })
    created_at: Date;

    toJSON() {
        return {
            guild_id: this.guild_id,
            user_id: this.user_id,
            role_id: this.role_id,
            expires_at: new Date(this.expires_at).toISOString(),
            assigned_by: this.assigned_by ?? null,
            created_at: new Date(this.created_at).toISOString(),
        };
    }

    static async forMember(guild_id: string, user_id: string): Promise<RoleExpirationMap> {
        return (await MemberRoleExpiration.forMembers(guild_id, [user_id])).get(user_id) ?? {};
    }

    static async forMembers(guild_id: string, user_ids: string[]): Promise<Map<string, RoleExpirationMap>> {
        const result = new Map<string, RoleExpirationMap>();
        if (!user_ids.length) return result;
        const rows = await MemberRoleExpiration.find({
            where: { guild_id, user_id: In([...new Set(user_ids)]) },
            select: { user_id: true, role_id: true, expires_at: true },
            order: { expires_at: "ASC" },
        });
        for (const row of rows) {
            const map = result.get(row.user_id) ?? {};
            map[row.role_id] = new Date(row.expires_at).toISOString();
            result.set(row.user_id, map);
        }
        return result;
    }

    static async setFor(member: { index: string | number; id: string; guild_id: string }, role_id: string, expires_at: Date | null, assigned_by?: string | null) {
        if (!expires_at) {
            await MemberRoleExpiration.delete({ guild_id: member.guild_id, user_id: member.id, role_id });
            return;
        }
        await MemberRoleExpiration.upsert(
            {
                guild_id: member.guild_id,
                user_id: member.id,
                role_id,
                member_index: Number(member.index),
                expires_at,
                assigned_by: assigned_by ?? null,
            },
            ["guild_id", "user_id", "role_id"],
        );
    }
}
