import type { DataSource } from "typeorm";

const deadlineMs = 2000;
let pending: Promise<boolean> | undefined;
let pendingDatabase: DataSource | undefined;

export function databaseReady(database: DataSource | null): Promise<boolean> {
    if (!database?.isInitialized) return Promise.resolve(false);
    if (pending) return pendingDatabase === database ? pending : Promise.resolve(false);

    pendingDatabase = database;
    pending = new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), deadlineMs);
        Promise.resolve()
            .then(() => database.query("SELECT 1"))
            .then(
                () => resolve(database.isInitialized),
                () => resolve(false),
            )
            .finally(() => {
                clearTimeout(timer);
                pending = undefined;
                pendingDatabase = undefined;
            });
    });
    return pending;
}
