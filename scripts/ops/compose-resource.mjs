const key = process.argv[2];
const result = Bun.spawnSync(["docker", "compose", ...(process.env.ENV_FILE ? ["--env-file", process.env.ENV_FILE] : []), "config", "--format", "json"], { stderr: "pipe" });
if (result.exitCode !== 0) throw new Error("Cannot resolve Compose configuration");
const config = JSON.parse(result.stdout.toString());
const targets = { state: "/data/state", storage: "/data/storage", client: "/data/client" };
const mount = targets[key] && config.services.server.volumes.find((item) => item.target === targets[key]);
if (targets[key] && mount?.type !== "volume") throw new Error(`Expected a named volume for ${key}`);
const value =
    key === "database"
        ? config.services.postgres.environment.POSTGRES_DB
        : key === "user"
          ? config.services.postgres.environment.POSTGRES_USER
          : config.volumes[mount?.source ?? key]?.name;
if (typeof value !== "string" || !value || value.includes("\n")) throw new Error(`Missing Compose resource: ${key}`);
if (!["database", "user"].includes(key)) {
    const inspect = Bun.spawnSync(["docker", "volume", "inspect", value], { stdout: "ignore", stderr: "ignore" });
    if (inspect.exitCode !== 0) throw new Error(`Volume does not exist: ${value}`);
}
console.log(value);
