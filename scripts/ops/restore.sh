#!/bin/sh
set -eu
backup_dir=${1:?usage: scripts/ops/restore.sh BACKUP_DIRECTORY}
(cd "$backup_dir" && shasum -a 256 -c SHA256SUMS)
compose() {
    if [ -n "${ENV_FILE:-}" ]; then compose --env-file "$ENV_FILE" "$@"; else compose "$@"; fi
}
state_volume=$(bun scripts/ops/compose-resource.mjs state)
storage_volume=$(bun scripts/ops/compose-resource.mjs storage)
database_user=$(bun scripts/ops/compose-resource.mjs user)
database_name=$(bun scripts/ops/compose-resource.mjs database)
compose stop server
table_count=$(compose exec -T postgres psql -U "$database_user" -d "$database_name" -Atc "select count(*) from information_schema.tables where table_schema = 'public'")
[ "$table_count" = 0 ] || { printf 'Refusing restore: target database is not empty\n' >&2; exit 1; }
docker run --rm -v "$state_volume:/state:ro" -v "$storage_volume:/storage:ro" alpine sh -ec 'test -z "$(find /state /storage -mindepth 1 -print -quit)"' || { printf 'Refusing restore: target file volumes are not empty\n' >&2; exit 1; }
compose exec -T postgres pg_restore --exit-on-error --single-transaction --no-owner -U "$database_user" -d "$database_name" < "$backup_dir/database.dump"
docker run --rm -i -v "$state_volume:/state" -v "$storage_volume:/storage" alpine tar xzf - -C / < "$backup_dir/files.tar.gz"
printf 'Restore complete. Validate keys and files before starting the server.\n'
