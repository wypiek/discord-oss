import { Column, Entity, PrimaryGeneratedColumn, BaseEntity } from "typeorm";

@Entity({
    name: "migrations",
})
export class Migration extends BaseEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: "bigint" })
    timestamp: number;

    @Column()
    name: string;
}
