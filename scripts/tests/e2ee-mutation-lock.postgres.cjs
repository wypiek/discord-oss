const assert = require("node:assert/strict");
const { test, before, after, mock } = require("node:test");
const { Client } = require("pg");
const { randomUUID } = require("node:crypto");
const enabled = process.env.E2EE_MUTATION_LOCK_TEST === "1";
let admin, db, databaseName, entities, user, withE2eeMutation;

before(async () => {
    if (!enabled) return;
    assert.ok(process.env.DATABASE_TEST_ADMIN_URL);
    admin = new Client({ connectionString: process.env.DATABASE_TEST_ADMIN_URL });
    await admin.connect();
    databaseName = `meowcord_e2ee_lock_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    const url = new URL(process.env.DATABASE_TEST_ADMIN_URL);
    url.pathname = `/${databaseName}`;
    process.env.DATABASE = url.toString();
    process.env.APPLY_DB_MIGRATIONS = "true";
    process.env.DB_POOL_SIZE = "4";
    delete process.env.DB_SYNC;
    entities = require("../../dist/database");
    db = await entities.initDatabase();
    ({ withE2eeMutation } = require("../../dist/api/util/utility/e2ee"));
    user = await entities.User.register({ username: "e2ee_lock_fixture" });
});

after(async () => {
    if (!enabled) return;
    try {
        if (db?.isInitialized) await db.destroy();
        if (databaseName) await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    } finally {
        await admin?.end();
    }
});

const gate = () => {
    let resolve;
    const promise = new Promise((done) => {
        resolve = done;
    });
    return { promise, resolve };
};

test("E2EE mutations serialize even before an identity exists and read state after acquiring the lock", { skip: !enabled, timeout: 10000 }, async () => {
    const acquired = gate();
    const release = gate();
    let secondEntered = false;
    const first = withE2eeMutation(user.id, async (manager) => {
        acquired.resolve();
        await release.promise;
        await manager.insert(entities.E2eeIdentity, {
            user_id: user.id,
            public_key: "current",
            previous_key: null,
            rotation_signature: null,
            created_at: new Date(),
        });
    });
    await acquired.promise;
    const second = withE2eeMutation(user.id, async (manager) => {
        secondEntered = true;
        const identity = await manager.findOneOrFail(entities.E2eeIdentity, { where: { user_id: user.id } });
        assert.equal(identity.public_key, "current");
    });
    try {
        await new Promise((resolve) => setTimeout(resolve, 75));
        assert.equal(secondEntered, false);
    } finally {
        release.resolve();
    }
    await Promise.all([first, second]);
});

test("a rejected E2EE mutation rolls back every write and releases its account lock", { skip: !enabled }, async () => {
    await assert.rejects(
        withE2eeMutation(user.id, async (manager) => {
            await manager.update(entities.E2eeIdentity, { user_id: user.id }, { public_key: "rolled_back" });
            throw new Error("reject stale request");
        }),
        /reject stale request/,
    );
    await withE2eeMutation(user.id, async (manager) => {
        const identity = await manager.findOneOrFail(entities.E2eeIdentity, { where: { user_id: user.id } });
        assert.equal(identity.public_key, "current");
    });
});

test("reset rejects a password hash changed while password verification is pending", { skip: !enabled }, async () => {
    const oldData = { ...user.data, hash: "verified_hash" };
    await entities.User.update({ id: user.id }, { data: oldData });
    const verifying = gate();
    const complete = gate();
    const bcrypt = require("bcrypt");
    mock.method(bcrypt, "compare", async () => {
        verifying.resolve();
        await complete.promise;
        return true;
    });
    const router = require("../../dist/api/routes/users/@me/e2ee/index").default;
    const reset = router.stack.find((layer) => layer.route?.path === "/reset").route.stack.at(-1).handle;
    const request = { user_id: user.id, body: { password: "old_password", public_key: Buffer.alloc(32, 1).toString("base64url") } };
    const result = reset(request, {});
    try {
        await verifying.promise;
        await entities.User.update({ id: user.id }, { data: { ...oldData, hash: "changed_hash" } });
        complete.resolve();
        await assert.rejects(result);
        const identity = await entities.E2eeIdentity.findOneOrFail({ where: { user_id: user.id } });
        assert.equal(identity.public_key, "current");
    } finally {
        complete.resolve();
        mock.restoreAll();
    }
});
