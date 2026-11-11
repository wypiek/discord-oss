export interface ConfigStore {
    refresh(overrides?: object): Promise<unknown>;
    insertMissing(): Promise<number>;
}

export interface ConfigEnv {
    CONFIG_JSON?: string;
    CONFIG_OVERRIDE?: string;
    CONFIG_TTL_SECONDS?: string;
}

const parseOverride = (env: ConfigEnv) => {
    if (!env.CONFIG_OVERRIDE) return undefined;
    try {
        return JSON.parse(env.CONFIG_OVERRIDE) as object;
    } catch (error) {
        console.error("[Config] CONFIG_OVERRIDE is not valid JSON, ignoring it:", (error as Error).message);
        return undefined;
    }
};

export const databaseConfig = (store: ConfigStore, countRows: () => Promise<number>, env: ConfigEnv) => {
    const override = parseOverride(env);
    const ttl = (Number(env.CONFIG_TTL_SECONDS) || 30) * 1000;
    let loadedAt = 0;
    let loading: Promise<void> | undefined;

    const load = async () => {
        Reflect.deleteProperty(process.env, "CONFIG_PATH");
        process.env.CONFIG_SOURCE = "database";
        if (env.CONFIG_JSON && !(await countRows())) {
            process.env.CONFIG_JSON = env.CONFIG_JSON;
            try {
                await store.refresh();
            } finally {
                Reflect.deleteProperty(process.env, "CONFIG_JSON");
            }
            const written = await store.insertMissing();
            console.log(`[Config] the config table was empty, wrote ${written} keys from CONFIG_JSON`);
        } else {
            Reflect.deleteProperty(process.env, "CONFIG_JSON");
            await store.refresh();
            const written = await store.insertMissing();
            if (written) console.log(`[Config] wrote ${written} missing keys with their defaults`);
        }
        await store.refresh(override);
        loadedAt = Date.now();
    };

    const reload = async () => {
        await store.refresh(override);
        loadedAt = Date.now();
    };

    return {
        load,
        reload,
        refreshIfStale: () => {
            if (loading || Date.now() - loadedAt < ttl) return undefined;
            loading = reload()
                .catch((error: Error) => console.warn("[Config] could not reload the configuration:", error.message))
                .finally(() => {
                    loading = undefined;
                });
            return loading;
        },
        touch: () => {
            loadedAt = Date.now();
        },
    };
};
