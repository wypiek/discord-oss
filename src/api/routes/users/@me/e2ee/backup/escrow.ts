import bcrypt from "bcrypt";
import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { decodeKey, e2eeDeviceMessage, E2eeErrors, e2eeRateLimit, passwordMismatch, verifyEd25519, withE2eeMutation } from "@spacebar/api/util";
import { openRecoverySecret, recoveryProof, sealRecoverySecret, validateBackupSecret } from "@spacebar/api/util/utility/e2eeRecovery";
import { E2eeDevice, E2eeIdentity, E2eeKeyBackup, E2eeRecovery, User } from "@spacebar/database";
import { E2eePasswordSchema, E2eeRecoverySchema } from "@spacebar/schemas";
import { Config } from "@spacebar/util";

const router: Router = Router({ mergeParams: true });
const trusted = () => {
    if (Config.get().limits.e2ee.trustServerByDefault === false) throw E2eeErrors.UNSUPPORTED;
};

router.get(
    "/",
    e2eeRateLimit("e2ee_recovery_status", 60, 60),
    route({ spacebarOnly: true, responses: { 200: { body: "E2eeRecoveryStatusResponse" } } }),
    async (req: Request, res: Response) => {
        res.setHeader("Cache-Control", "no-store");
        trusted();
        const status = await withE2eeMutation(req.user_id, async (manager) => {
            const identity = await manager.findOne(E2eeIdentity, {
                where: { user_id: req.user_id },
                lock: { mode: "pessimistic_read" },
            });
            const backup = await manager.findOne(E2eeKeyBackup, {
                where: { user_id: req.user_id },
                lock: { mode: "pessimistic_read" },
            });
            const recovery = await manager.findOne(E2eeRecovery, {
                where: { user_id: req.user_id },
                lock: { mode: "pessimistic_read" },
            });
            if (
                !identity ||
                !backup ||
                !recovery ||
                identity.public_key !== backup.identity_key ||
                recovery.identity_key !== backup.identity_key ||
                recovery.backup_public_key !== backup.backup_public_key
            )
                return { ready: false };
            try {
                const secret = await openRecoverySecret(req.user_id, recovery.identity_key, recovery.backup_public_key, recovery.encrypted_secret);
                if (!validateBackupSecret(req.user_id, backup, secret)) return { ready: false };
            } catch {
                return { ready: false };
            }
            trusted();
            return {
                ready: true,
                identity_key: backup.identity_key,
                backup_public_key: backup.backup_public_key,
                backup_version: backup.version,
            };
        });
        res.json(status);
    },
);

router.put(
    "/",
    e2eeRateLimit("e2ee_recovery_upload", 20, 3600),
    route({
        spacebarOnly: true,
        requestBody: "E2eeRecoverySchema",
        responses: { 204: {}, 400: { body: "APIErrorResponse" }, 409: { body: "APIErrorResponse" } },
    }),
    async (req: Request, res: Response) => {
        res.setHeader("Cache-Control", "no-store");
        trusted();
        const body = req.body as E2eeRecoverySchema;
        if (!decodeKey(body.backup_secret, 32) || !Number.isInteger(body.backup_version) || body.backup_version < 1) throw E2eeErrors.INVALID_BACKUP;
        await withE2eeMutation(req.user_id, async (manager) => {
            const identity = await manager.findOne(E2eeIdentity, {
                where: { user_id: req.user_id },
                lock: { mode: "pessimistic_write" },
            });
            const backup = await manager.findOne(E2eeKeyBackup, {
                where: { user_id: req.user_id },
                lock: { mode: "pessimistic_write" },
            });
            if (!identity || !backup) throw E2eeErrors.NO_BACKUP;
            if (identity.public_key !== body.identity_key || backup.identity_key !== identity.public_key || backup.version !== body.backup_version)
                throw E2eeErrors.BACKUP_CONFLICT;
            const device = await manager.findOne(E2eeDevice, {
                where: { id: body.device_id, user_id: req.user_id },
                lock: { mode: "pessimistic_write" },
            });
            if (!device || device.status !== "active" || !req.session?.session_id || device.session_id !== req.session.session_id) throw E2eeErrors.UNKNOWN_DEVICE;
            if (!device.identity_signature || !verifyEd25519(identity.public_key, e2eeDeviceMessage(req.user_id, device.id, device.signing_key), device.identity_signature))
                throw E2eeErrors.INVALID_SIGNATURE;
            if (!verifyEd25519(identity.public_key, recoveryProof(req.user_id, body.identity_key, body.backup_version, body.device_id, body.backup_secret), body.signature))
                throw E2eeErrors.INVALID_SIGNATURE;
            if (!validateBackupSecret(req.user_id, backup, body.backup_secret)) throw E2eeErrors.INVALID_BACKUP;
            const encrypted_secret = await sealRecoverySecret(req.user_id, identity.public_key, backup.backup_public_key, body.backup_secret);
            trusted();
            await manager.upsert(
                E2eeRecovery,
                {
                    user_id: req.user_id,
                    identity_key: identity.public_key,
                    backup_public_key: backup.backup_public_key,
                    backup_version: backup.version,
                    encrypted_secret,
                    updated_at: new Date(),
                },
                ["user_id"],
            );
        });
        res.sendStatus(204);
    },
);

router.post(
    "/recover",
    e2eeRateLimit("e2ee_recovery_password", 10, 600),
    route({
        spacebarOnly: true,
        requestBody: "E2eePasswordSchema",
        responses: {
            200: { body: "E2eeRecoveryResponse" },
            400: { body: "APIErrorResponse" },
            404: { body: "APIErrorResponse" },
        },
    }),
    async (req: Request, res: Response) => {
        res.setHeader("Cache-Control", "no-store");
        trusted();
        const password = (req.body as E2eePasswordSchema).password;
        const user = await User.findOneOrFail({
            where: { id: req.user_id },
            select: { id: true, data: true },
        });
        if (typeof password !== "string" || !user.data?.hash || !(await bcrypt.compare(password, user.data.hash))) throw passwordMismatch();
        const backup_secret = await withE2eeMutation(req.user_id, async (manager) => {
            const currentUser = await manager.findOne(User, {
                where: { id: req.user_id },
                select: { id: true, data: true },
                lock: { mode: "pessimistic_read" },
            });
            if (!currentUser || currentUser.data.hash !== user.data.hash) throw passwordMismatch();
            const identity = await manager.findOne(E2eeIdentity, {
                where: { user_id: req.user_id },
                lock: { mode: "pessimistic_read" },
            });
            const backup = await manager.findOne(E2eeKeyBackup, {
                where: { user_id: req.user_id },
                lock: { mode: "pessimistic_read" },
            });
            const recovery = await manager.findOne(E2eeRecovery, {
                where: { user_id: req.user_id },
                lock: { mode: "pessimistic_read" },
            });
            if (!identity || !backup || !recovery) throw E2eeErrors.NO_BACKUP;
            if (identity.public_key !== recovery.identity_key || backup.identity_key !== recovery.identity_key || backup.backup_public_key !== recovery.backup_public_key)
                throw E2eeErrors.BACKUP_CONFLICT;
            const secret = await openRecoverySecret(req.user_id, recovery.identity_key, recovery.backup_public_key, recovery.encrypted_secret);
            if (!validateBackupSecret(req.user_id, backup, secret)) throw E2eeErrors.INVALID_BACKUP;
            trusted();
            return secret;
        });
        res.json({ backup_secret });
    },
);

export default router;
