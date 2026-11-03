#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if [[ $# -ne 1 ]]; then
  echo 'Usage: RESTORE_TEST_ROOT_PASSWORD=<unique-test-password> scripts/restore-test.sh <backup.sql.age>' >&2
  exit 2
fi
: "${RESTORE_TEST_ROOT_PASSWORD:?Set a unique test-only restore password}"
: "${RESTORE_AGE_IDENTITY:?Set path to the protected age identity file}"
command -v age >/dev/null || { echo 'age is required on the host.' >&2; exit 1; }
command -v docker >/dev/null || { echo 'Docker is required on the host.' >&2; exit 1; }
backup="$(realpath -- "$1")"
[[ -f "$backup" && -s "$backup" ]] || { echo 'Backup file is missing or empty.' >&2; exit 1; }
manifest="${backup%.sql.age}.manifest.age"
checksum="${backup}.sha256"
[[ -f "$manifest" && -s "$manifest" ]] || { echo 'Encrypted row-count manifest is missing.' >&2; exit 1; }
[[ -f "$checksum" && -s "$checksum" ]] || { echo 'Backup checksum file is missing.' >&2; exit 1; }
(
  cd "$(dirname -- "$backup")"
  sha256sum -c "$(basename -- "$checksum")"
)
expected_counts="$(age -d -i "$RESTORE_AGE_IDENTITY" "$manifest")"

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"
compose=(docker compose -p vocabup-restore-test -f deploy/restore-test.compose.yml)
"${compose[@]}" up -d --wait
container="$("${compose[@]}" ps -q mysql)"
[[ -n "$container" ]] || { echo 'Isolated restore MySQL container was not created.' >&2; exit 1; }
state="$(docker inspect --format '{{.State.Health.Status}}' "$container")"
[[ "$state" == healthy ]] || { echo "Restore MySQL is not healthy (state: $state)." >&2; exit 1; }

restore_db="vocabup_restore_test_$(date -u +%Y%m%d%H%M%S)_$$"
"${compose[@]}" exec -T -e "RESTORE_DB=$restore_db" mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -e "CREATE DATABASE \`$RESTORE_DB\`"'
age -d -i "$RESTORE_AGE_IDENTITY" "$backup" | "${compose[@]}" exec -T -e "RESTORE_DB=$restore_db" mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot "$RESTORE_DB"'
actual_counts="$("${compose[@]}" exec -T -e "RESTORE_DB=$restore_db" mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --batch --skip-column-names -uroot "$RESTORE_DB"' <<'SQL'
SELECT 'users', COUNT(*) FROM users
UNION ALL SELECT 'decks', COUNT(*) FROM decks
UNION ALL SELECT 'cards', COUNT(*) FROM cards
UNION ALL SELECT 'reviews', COUNT(*) FROM reviews;
SQL
)"
[[ "$actual_counts" == "$expected_counts" ]] || { echo 'Restored row counts do not match the encrypted backup manifest.' >&2; exit 1; }
check_output="$("${compose[@]}" exec -T -e "RESTORE_DB=$restore_db" mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -e "CHECK TABLE \`$RESTORE_DB\`.users, \`$RESTORE_DB\`.decks, \`$RESTORE_DB\`.cards, \`$RESTORE_DB\`.reviews"')"
printf '%s\n' "$check_output"
ok_count="$(printf '%s\n' "$check_output" | awk '$3 == "status" && $4 == "OK" { count++ } END { print count + 0 }')"
[[ "$ok_count" == '4' ]] || { echo 'One or more restored tables failed CHECK TABLE.' >&2; exit 1; }
echo 'Restored row counts match the encrypted backup manifest.'
echo "Restore verification completed in isolated database: $restore_db"
echo 'The isolated container and named volume were retained; review them before any separately approved cleanup.'
