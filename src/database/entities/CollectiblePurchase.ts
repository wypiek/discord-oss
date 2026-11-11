import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { BaseClassWithoutId } from "./BaseClass";
import { User } from "./User";

@Entity({
    name: "collectible_purchases",
})
export class CollectiblePurchase extends BaseClassWithoutId {
    @PrimaryColumn({ type: "int8" })
    user_id: string;

    @PrimaryColumn({ type: "int8" })
    sku_id: string;

    @JoinColumn({ name: "user_id", foreignKeyConstraintName: "FK_collectible_purchase_user_id" })
    @ManyToOne(() => User, { onDelete: "CASCADE" })
    user: User;

    @Column({ type: "timestamp with time zone" })
    purchased_at: Date;
}
