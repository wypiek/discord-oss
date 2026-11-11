import { EntityManager } from "typeorm";
import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { decodeKey, e2eeBackupKeyMessage, E2eeErrors, e2eeRateLimit, verifyEd25519, withE2eeMutation } from "@spacebar/api/util";
import { E2eeIdentity, E2eeKeyBackup } from "@spacebar/database";
import { E2eeBackupKdf, E2eeBackupSchema, E2eeBackupSecretSchema, E2eeTrustSchema } from "@spacebar/schemas";
import { emitEvent } from "@spacebar/util";

const router: Router = Router({ mergeParams: true });

const blob = (value: unknown, max: number) => typeof value === "string" && value.length > 0 && value.length <= max && /^[A-Za-z0-9_-]+$/.test(value);

const inRange = (value: unknown, min: number, max: number) => Number.isInteger(value) && (value as number) >= min && (value as number) <= max;

const checkSecret = (body: E2eeBackupSecretSchema, allowEmpty: boolean) => {
    const kdf = body.kdf as E2eeBackupKdf | undefined;
    const argon = body.mode === "password" && kdf?.name === "argon2id" && inRange(kdf.memory, 19456, 1048576) && inRange(kdf.iterations, 1, 10) && inRange(kdf.parallelism, 1, 4);
    const hkdf = body.mode === "recovery" && kdf?.name === "hkdf-sha256";
    if (!argon && !hkdf) throw E2eeErrors.INVALID_BACKUP;
    if (!decodeKey(body.salt, 16)) throw E2eeErrors.INVALID_BACKUP;
    if (body.wrapped_secret === null ? !allowEmpty : !blob(body.wrapped_secret, 128)) throw E2eeErrors.INVALID_BACKUP;
    if (!Number.isInteger(body.version) || body.version < 0) throw E2eeErrors.INVALID_BACKUP;
};

const save = async (manager: EntityManager, userId: string, version: number, fields: Partial<E2eeKeyBackup>) => {
    const updated_at = new Date();
    if (version === 0) {
        try {
            await manager.insert(E2eeKeyBackup, { ...fields, user_id: userId, version: 1, updated_at });
        } catch {
            throw E2eeErrors.BACKUP_CONFLICT;
        }
    } else {
        const result = await manager.update(E2eeKeyBackup, { user_id: userId, version }, { ...fields, version: version + 1, updated_at });
        if (!result.affected) throw E2eeErrors.BACKUP_CONFLICT;
    }
    return (await manager.findOneOrFail(E2eeKeyBackup, { where: { user_id: userId } })).toPublic();
};

router.get(
    "/",
    route({
        spacebarOnly: true,
        responses: { 200: { body: "E2eeBackupResponse" } },
    }),
    async (req: Request, res: Response) => {
        const backup = await E2eeKeyBackup.findOne({ where: { user_id: req.user_id } });
        res.json(backup?.toPublic() ?? null);
    },
);

router.put(
    "/",
    e2eeRateLimit("e2ee_backup", 10, 3600),
    route({
        spacebarOnly: true,
        requestBody: "E2eeBackupSchema",
        responses: {
            200: { body: "E2eeBackupResponse" },
            400: { body: "APIErrorResponse" },
            409: { body: "APIErrorResponse" },
        },
    }),
    async (req: Request, res: Response) => {
        const body = req.body as E2eeBackupSchema;
        checkSecret(body, true);
        if (!blob(body.wrapped_identity, 512) || !blob(body.wrapped_backup_key, 512) || !decodeKey(body.backup_public_key, 32)) throw E2eeErrors.INVALID_BACKUP;
        const result = await withE2eeMutation(req.user_id, async (manager) => {
            const identity = await manager.findOne(E2eeIdentity, { where: { user_id: req.user_id } });
            if (!identity) throw E2eeErrors.NO_IDENTITY;
            if (body.identity_key !== identity.public_key) throw E2eeErrors.INVALID_BACKUP;
            if (!verifyEd25519(identity.public_key, e2eeBackupKeyMessage(req.user_id, body.backup_public_key), body.backup_key_signature)) throw E2eeErrors.INVALID_SIGNATURE;
            const fields = {
                mode: body.mode,
                kdf: body.kdf,
                salt: body.salt,
                wrapped_secret: body.wrapped_secret,
                identity_key: body.identity_key,
                wrapped_identity: body.wrapped_identity,
                backup_public_key: body.backup_public_key,
                backup_key_signature: body.backup_key_signature,
                wrapped_backup_key: body.wrapped_backup_key,
            };
            return save(manager, req.user_id, body.version, fields);
        });
        res.json(result);
    },
);

router.patch(
    "/",
    e2eeRateLimit("e2ee_backup", 10, 3600),
    route({
        spacebarOnly: true,
        requestBody: "E2eeBackupSecretSchema",
        responses: {
            200: { body: "E2eeBackupResponse" },
            400: { body: "APIErrorResponse" },
            404: { body: "APIErrorResponse" },
            409: { body: "APIErrorResponse" },
        },
    }),
    async (req: Request, res: Response) => {
        const body = req.body as E2eeBackupSecretSchema;
        checkSecret(body, false);
        const result = await withE2eeMutation(req.user_id, async (manager) => {
            if (!(await manager.findOne(E2eeKeyBackup, { where: { user_id: req.user_id }, select: { user_id: true } }))) throw E2eeErrors.NO_BACKUP;
            return save(manager, req.user_id, body.version, {
                mode: body.mode,
                kdf: body.kdf,
                salt: body.salt,
                wrapped_secret: body.wrapped_secret,
            });
        });
        res.json(result);
    },
);

router.put(
    "/trust",
    e2eeRateLimit("e2ee_trust", 60, 600),
    route({
        spacebarOnly: true,
        requestBody: "E2eeTrustSchema",
        responses: {
            200: { body: "E2eeTrustResponse" },
            400: { body: "APIErrorResponse" },
            404: { body: "APIErrorResponse" },
            409: { body: "APIErrorResponse" },
        },
    }),
    async (req: Request, res: Response) => {
        const body = req.body as E2eeTrustSchema;
        if (!Number.isInteger(body.version) || body.version < 0 || !blob(body.data, 65536)) throw E2eeErrors.INVALID_BACKUP;
        await withE2eeMutation(req.user_id, async (manager) => {
            if (!(await manager.findOne(E2eeKeyBackup, { where: { user_id: req.user_id }, select: { user_id: true } }))) throw E2eeErrors.NO_BACKUP;
            const result = await manager.update(E2eeKeyBackup, { user_id: req.user_id, trust_version: body.version }, { trust: body.data, trust_version: body.version + 1 });
            if (!result.affected) throw E2eeErrors.BACKUP_CONFLICT;
        });
        const trust = { version: body.version + 1, data: body.data };
        await emitEvent({
            event: "E2EE_TRUST_UPDATE",
            user_id: req.user_id,
            data: { version: trust.version },
        });
        res.json(trust);
    },
);

export default router;
