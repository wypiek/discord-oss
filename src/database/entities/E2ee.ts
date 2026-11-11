import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { E2eeBackupKdf, E2eeBackupMode, E2eeBackupResponse, E2eeDeviceResponse, E2eeDeviceStatus } from "@spacebar/schemas";
import { BaseClassWithoutId } from "./BaseClass";
import { User } from "./User";

@Entity({
    name: "e2ee_identities",
})
export class E2eeIdentity extends BaseClassWithoutId {
    @PrimaryColumn({ type: "int8" })
    user_id: string;

    @JoinColumn({ name: "user_id", foreignKeyConstraintName: "FK_e2ee_identity_user_id" })
    @ManyToOne(() => User, { onDelete: "CASCADE" })
    user: User;

    @Column()
    public_key: string;

    @Column({ type: "varchar", nullable: true })
    previous_key: string | null;

    @Column({ type: "varchar", nullable: true })
    rotation_signature: string | null;

    @Column({ type: "timestamp with time zone" })
    created_at: Date;
}

@Entity({
    name: "e2ee_devices",
})
export class E2eeDevice extends BaseClassWithoutId {
    @PrimaryColumn()
    id: string;

    @Index("IDX_e2ee_device_user_id")
    @Column({ type: "int8" })
    user_id: string;

    @JoinColumn({ name: "user_id", foreignKeyConstraintName: "FK_e2ee_device_user_id" })
    @ManyToOne(() => User, { onDelete: "CASCADE" })
    user: User;

    @Column()
    signing_key: string;

    @Column({ type: "varchar", nullable: true })
    identity_signature: string | null;

    @Column({ type: "varchar" })
    status: E2eeDeviceStatus;

    @Column({ type: "varchar", nullable: true })
    name: string | null;

    @Column({ type: "int" })
    prekey_id: number;

    @Column()
    prekey_public: string;

    @Column()
    prekey_signature: string;

    @Column({ type: "timestamp with time zone" })
    prekey_updated_at: Date;

    @Column({ type: "timestamp with time zone" })
    created_at: Date;

    @Column({ type: "timestamp with time zone", nullable: true })
    revoked_at: Date | null;

    @Column({ type: "varchar", nullable: true })
    session_id: string | null;

    toPublic(): E2eeDeviceResponse {
        return {
            device_id: this.id,
            signing_key: this.signing_key,
            identity_signature: this.identity_signature,
            status: this.status,
            name: this.name,
            prekey: {
                id: this.prekey_id,
                public_key: this.prekey_public,
                signature: this.prekey_signature,
            },
            created_at: this.created_at.toISOString(),
            revoked_at: this.revoked_at?.toISOString() ?? null,
        };
    }
}

@Entity({
    name: "e2ee_key_backups",
})
export class E2eeKeyBackup extends BaseClassWithoutId {
    @PrimaryColumn({ type: "int8" })
    user_id: string;

    @JoinColumn({ name: "user_id", foreignKeyConstraintName: "FK_e2ee_key_backup_user_id" })
    @ManyToOne(() => User, { onDelete: "CASCADE" })
    user: User;

    @Column({ type: "int" })
    version: number;

    @Column({ type: "varchar" })
    mode: E2eeBackupMode;

    @Column({ type: "jsonb" })
    kdf: E2eeBackupKdf;

    @Column()
    salt: string;

    @Column({ type: "varchar", nullable: true })
    wrapped_secret: string | null;

    @Column()
    identity_key: string;

    @Column()
    wrapped_identity: string;

    @Column()
    backup_public_key: string;

    @Column()
    backup_key_signature: string;

    @Column()
    wrapped_backup_key: string;

    @Column({ type: "timestamp with time zone" })
    updated_at: Date;

    @Column({ type: "varchar", nullable: true })
    trust: string | null;

    @Column({ type: "int", default: 0 })
    trust_version: number;

    toPublic(): E2eeBackupResponse {
        return {
            version: this.version,
            mode: this.mode,
            kdf: this.kdf,
            salt: this.salt,
            wrapped_secret: this.wrapped_secret,
            identity_key: this.identity_key,
            wrapped_identity: this.wrapped_identity,
            backup_public_key: this.backup_public_key,
            backup_key_signature: this.backup_key_signature,
            wrapped_backup_key: this.wrapped_backup_key,
            updated_at: this.updated_at.toISOString(),
            trust: { version: this.trust_version, data: this.trust },
        };
    }
}

@Entity({
    name: "e2ee_backup_keys",
})
export class E2eeBackupKey extends BaseClassWithoutId {
    @PrimaryColumn({ type: "int8" })
    user_id: string;

    @PrimaryColumn({ type: "int8" })
    message_id: string;

    @JoinColumn({ name: "user_id", foreignKeyConstraintName: "FK_e2ee_backup_key_user_id" })
    @ManyToOne(() => User, { onDelete: "CASCADE" })
    user: User;

    @Column()
    enc: string;

    @Column()
    wrapped: string;

    @Column({ type: "timestamp with time zone" })
    created_at: Date;
}

@Entity({ name: "e2ee_recovery" })
export class E2eeRecovery extends BaseClassWithoutId {
    @PrimaryColumn({ type: "int8" })
    user_id: string;

    @JoinColumn({ name: "user_id", foreignKeyConstraintName: "FK_e2ee_recovery_user_id" })
    @ManyToOne(() => User, { onDelete: "CASCADE" })
    user: User;

    @Column()
    identity_key: string;

    @Column()
    backup_public_key: string;

    @Column({ type: "int" })
    backup_version: number;

    @Column()
    encrypted_secret: string;

    @Column({ type: "timestamp with time zone" })
    updated_at: Date;
}
