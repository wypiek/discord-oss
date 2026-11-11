import { Column, Entity, JoinColumn, ManyToOne } from "typeorm";
import { BaseClass } from "./BaseClass";
import { User } from "./User";

@Entity({
    name: "security_keys",
})
export class SecurityKey extends BaseClass {
    @Column({ nullable: true })
    user_id: string;

    @JoinColumn({ name: "user_id", foreignKeyConstraintName: "FK_security_key_user_id" })
    @ManyToOne(() => User, {
        onDelete: "CASCADE",
    })
    user: User;

    @Column()
    key_id: string;

    @Column()
    public_key: string;

    @Column()
    counter: number;

    @Column()
    name: string;

    static async authenticatorTypes(user_id: string) {
        const [keys, user] = await Promise.all([
            SecurityKey.count({ where: { user_id } }),
            User.findOne({
                where: { id: user_id },
                select: { id: true, mfa_enabled: true, totp_secret: true, flags: true, phone: true },
            }),
        ]);
        const totp = !!(user?.mfa_enabled && user.totp_secret);
        const sms = totp && !!user?.phone && (BigInt(String(user.flags ?? 0)) & 16n) === 16n;
        return [...(keys ? [1] : []), ...(totp ? [2] : []), ...(sms ? [3] : [])];
    }
}
