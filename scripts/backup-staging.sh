#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"
: "${BACKUP_AGE_RECIPIENT:?Set BACKUP_AGE_RECIPIENT to an age public recipient}"
command -v age >/dev/null || { echo 'age is required on the host.' >&2; exit 1; }
command -v sha256sum >/dev/null || { echo 'sha256sum is required on the host.' >&2; exit 1; }

staging_env="${STAGING_ENV_FILE:-staging.env}"
staging_project="${STAGING_COMPOSE_PROJECT:-vocabup-staging}"
[[ -f "$staging_env" ]] || { echo "Staging env file not found: $staging_env" >&2; exit 1; }
compose=(docker compose -p "$staging_project" --env-file "$staging_env" -f docker-compose.staging.yml)
container="$("${compose[@]}" ps -q mysql)"
[[ -n "$container" ]] || { echo 'Staging MySQL container is not running.' >&2; exit 1; }
state="$(docker inspect --format '{{.State.Health.Status}}' "$container")"
[[ "$state" == healthy ]] || { echo "Staging MySQL is not healthy (state: $state)." >&2; exit 1; }

backup_dir="$repo_dir/backups"
mkdir -p -- "$backup_dir"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
output="$backup_dir/vocabup-staging-$stamp.sql.age"
manifest_output="${output%.sql.age}.manifest.age"
temporary="$output.tmp"
manifest_temporary="$manifest_output.tmp"
trap 'rm -f -- "$temporary" "$manifest_temporary"' EXIT

# Stream mysqldump directly into age; plaintext is not written to the VPS filesystem.
"${compose[@]}" exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump --single-transaction --routines --triggers --hex-blob --no-tablespaces -uroot vocabup_staging' \
  | age -r "$BACKUP_AGE_RECIPIENT" -o "$temporary"
[[ -s "$temporary" ]] || { echo 'Encrypted backup is empty.' >&2; exit 1; }

# Keep writers paused during this operation so row-count evidence describes the dump.
counts="$("${compose[@]}" exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --batch --skip-column-names -uroot vocabup_staging' <<'SQL'
SELECT 'users', COUNT(*) FROM users
UNION ALL SELECT 'decks', COUNT(*) FROM decks
UNION ALL SELECT 'cards', COUNT(*) FROM cards
UNION ALL SELECT 'reviews', COUNT(*) FROM reviews;
SQL
)"
printf '%s\n' "$counts" | age -r "$BACKUP_AGE_RECIPIENT" -o "$manifest_temporary"
[[ -s "$manifest_temporary" ]] || { echo 'Encrypted backup manifest is empty.' >&2; exit 1; }
mv -- "$temporary" "$output"
mv -- "$manifest_temporary" "$manifest_output"
(
  cd "$backup_dir"
  sha256sum "$(basename -- "$output")" "$(basename -- "$manifest_output")" > "$(basename -- "$output").sha256"
)
echo "Encrypted staging backup created: $output"
echo "Encrypted row-count manifest created: $manifest_output"
echo "Checksums written: $output.sha256"
