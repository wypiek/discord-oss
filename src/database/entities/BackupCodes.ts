import { Column, Entity, JoinColumn, ManyToOne } from "typeorm";
import { BaseClass } from "./BaseClass";
import { User } from "./User";
import crypto from "node:crypto";
import { Config } from "@spacebar/util/util";

@Entity({
    name: "backup_codes",
})
export class BackupCode extends BaseClass {
    @JoinColumn({ name: "user_id", foreignKeyConstraintName: "FK_backup_code_user_id" })
    @ManyToOne(() => User, { onDelete: "CASCADE" })
    user: User;

    @Column()
    code: string;

    @Column()
    consumed: boolean;

    @Column()
    expired: boolean;
}

export function generateMfaBackupCodes(user_id: string) {
    const backup_codes: BackupCode[] = [];
    for (let i = 0; i < Config.get().security.mfaBackupCodeCount; i++) {
        const code = BackupCode.create({
            user: { id: user_id },
            code: crypto.randomBytes(4).toString("hex"), // 8 characters
            consumed: false,
            expired: false,
        });
        backup_codes.push(code);
    }

    return backup_codes;
}
