#!/bin/bash
set -euo pipefail

if [ "$#" -eq 0 ]; then
    echo "usage: scripts/dev/outside-app.sh [VAR=value ...] command [args ...]" >&2
    exit 64
fi

root=$(cd "$(dirname "$0")/../.." && pwd)
label="meowcord.outside.$$"
dir="${OUTSIDE_APP_DIR:-/private/tmp}/meowcord-outside-$$"
mkdir -p "$dir/run"
cleanup() {
    if [ ! -s "$dir/exit" ] && [ -s "$dir/pgid" ]; then
        kill -TERM -- "-$(cat "$dir/pgid")" 2>/dev/null || true
        sleep 2
        kill -KILL -- "-$(cat "$dir/pgid")" 2>/dev/null || true
    fi
    launchctl remove "$label" 2>/dev/null || true
    [ -n "${tail_pid:-}" ] && kill "$tail_pid" 2>/dev/null || true
    [ -n "${OUTSIDE_APP_KEEP:-}" ] || rm -rf "$dir"
}
trap cleanup EXIT
trap "exit 143" INT TERM

for entry in "$root"/* "$root"/.[!.]*; do
    [ -e "$entry" ] || continue
    case "$(basename "$entry")" in
    .git | .claude | .vencord | files | releases) continue ;;
    esac
    cp -c -R "$entry" "$dir/run/"
done
for link in "$dir"/run/assets/*; do
    [ -L "$link" ] || continue
    target=$(readlink -f "$root/assets/$(basename "$link")")
    rm "$link"
    cp -c -R "$target" "$link"
done

{
    echo "#!/bin/bash"
    echo "[ -e $(printf '%q' "$dir/started") ] && exit 0"
    echo "touch $(printf '%q' "$dir/started")"
    echo "ps -o pgid= -p \$\$ | tr -d ' ' > $(printf '%q' "$dir/pgid")"
    echo "export PATH=$(printf '%q' "$PATH") HOME=$(printf '%q' "$HOME") USER=$(printf '%q' "$USER")"
    echo "cd $(printf '%q' "$dir/run")"
    printf 'env'
    printf ' %q' "$@"
    echo " > $(printf '%q' "$dir/out.log") 2>&1"
    echo "echo \$? > $(printf '%q' "$dir/exit")"
} > "$dir/job.sh"

touch "$dir/out.log"
launchctl submit -l "$label" -- /bin/bash "$dir/job.sh"
tail -n +1 -f "$dir/out.log" &
tail_pid=$!
until [ -s "$dir/exit" ]; do sleep 2; done
sleep 1
status=$(cat "$dir/exit")
exit "$status"
