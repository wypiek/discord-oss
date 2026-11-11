import { Column, Entity, JoinColumn, ManyToOne, Index } from "typeorm";
import { BaseClass } from "./BaseClass";
import { User } from "./User";
import { ConnectedAccountTokenData } from "@spacebar/schemas";

@Entity({
    name: "connected_accounts",
})
export class ConnectedAccount extends BaseClass {
    @Column()
    external_id: string;

    @Column({ nullable: true })
    @Index("IDX_connected_accounts_user_id")
    user_id: string;

    @JoinColumn({ name: "user_id", foreignKeyConstraintName: "FK_connected_account_user_id" })
    @ManyToOne(() => User, {
        onDelete: "CASCADE",
    })
    user: User;

    @Column({ select: false })
    friend_sync?: boolean = false;

    @Column()
    name: string;

    @Column({ select: false })
    revoked?: boolean = false;

    @Column({ select: false })
    show_activity?: number = 0;

    @Column()
    type: string;

    @Column()
    verified?: boolean = true;

    @Column({ select: false })
    visibility?: number = 0;

    @Column({ type: "varchar", array: true })
    integrations?: string[] = [];

    @Column({ type: "jsonb", name: "metadata", nullable: true })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata_?: any;

    @Column()
    metadata_visibility?: number = 0;

    @Column()
    two_way_link?: boolean = false;

    @Column({ select: false, nullable: true, type: "jsonb" })
    token_data?: ConnectedAccountTokenData | null;

    async revoke() {
        this.revoked = true;
        this.token_data = null;
        await this.save();
    }
}
