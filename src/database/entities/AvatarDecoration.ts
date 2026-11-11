import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { AvatarDecorationData, PublicAvatarDecorationResponse } from "@spacebar/schemas";
import { BaseClass } from "./BaseClass";
import { User } from "./User";
import { Member } from "./Member";

@Entity({
    name: "avatar_decorations",
})
export class AvatarDecoration extends BaseClass {
    @Column({})
    asset: string;

    @Column({ default: false })
    approved: boolean;

    @Column({ nullable: true })
    @Index("IDX_avatar_decoration_uploader_id")
    uploader_id: string;

    @JoinColumn({ name: "uploader_id", foreignKeyConstraintName: "FK_avatar_decoration_uploader_id" })
    @ManyToOne(() => User, { onDelete: "CASCADE" })
    uploader: User;

    // access controls
    @Column({ default: false })
    public: boolean; // anyone can use

    @Column({ array: true, type: "int8" })
    allowed_user_ids: string[];

    @Column({ array: true, type: "int8" })
    allowed_guild_ids: string[];

    @Column({ array: true, type: "int8" })
    allowed_role_ids: string[];

    toJSON(): AvatarDecorationData {
        return {
            asset: this.asset,
            sku_id: this.id,
            expires_at: null,
        } satisfies AvatarDecorationData;
    }

    toPublicAvatarDecoration(opts?: { available: boolean }): PublicAvatarDecorationResponse {
        return {
            id: this.id,
            approved: this.approved,
            uploader: this.uploader.toPartialUser(),
            public: this.public,
            available: opts?.available ?? this.public,
        } satisfies PublicAvatarDecorationResponse;
    }

    async canUseAvatarDecoration(user_id: string): Promise<boolean> {
        if (!this.approved) return false;
        if (this.uploader_id == user_id) return true;
        if (this.allowed_user_ids.includes(user_id)) return true;

        let memberships: Member[];
        if (this.allowed_guild_ids.length > 0) {
            memberships ??= await Member.find({
                select: { guild_id: true, roles: { id: true } },
                where: { id: user_id },
                relations: { roles: true },
            });
            const guildIds = memberships.map((x) => x.guild_id);
            for (const allowedGuildId of this.allowed_guild_ids) if (guildIds.includes(allowedGuildId)) return true;
        }

        if (this.allowed_role_ids.length > 0) {
            memberships ??= await Member.find({
                select: { guild_id: true, roles: true },
                where: { id: user_id },
            });
            const roleIds = memberships.flatMap((x) => x.roles.map((x) => x.id));
            for (const allowedRoleId of this.allowed_role_ids) if (roleIds.includes(allowedRoleId)) return true;
        }

        return false;
    }
}
