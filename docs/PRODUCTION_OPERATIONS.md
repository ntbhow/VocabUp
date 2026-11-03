# VocabUp VPS staging and production operations

This guide prepares a Linux VPS deployment. It is not evidence that a VPS, DNS, TLS certificate, firewall, or production database has been provisioned. Run the staging steps first with staging-only credentials and an isolated volume. Compose publishes the app only on loopback; MySQL has no published port and is attached only to the internal database network. The app also joins a separate bridge network so Docker can forward the loopback port to host Nginx.

## 1. Prepare an Ubuntu VPS

Use a supported Ubuntu LTS release, a non-root operator with sudo, a DNS name pointed at the VPS, and a staging-only environment. Restrict inbound firewall rules to SSH from administrator addresses and TCP 80/443. Do not open 3306/33060. Confirm the VPS provider firewall and the host firewall agree; expected result is only the intended SSH/HTTP/HTTPS ingress.

```sh
sudo apt-get update
sudo apt-get install -y ca-certificates curl git nginx age
```

Purpose: install repository, HTTPS proxy, and encrypted-backup prerequisites. Expected result: all packages install successfully.

Install Docker Engine and the Compose plugin using Docker's official Ubuntu repository instructions for the VPS's Ubuntu release. Avoid the convenience script on long-lived hosts. The container build uses Node 24, so the VPS does not need a host Node installation. Verify the Docker installation:

```sh
sudo docker version
sudo docker compose version
```

Expected result: both client and server versions are printed and `docker compose` is available. Add the operator to the `docker` group only if its root-equivalent access is acceptable; otherwise use `sudo docker`.

## 2. Obtain source and configure staging

```sh
git clone https://github.com/ntbhow/VocabUp.git
cd VocabUp
git status --short
```

Purpose: obtain the reviewed source and confirm the checkout is clean before deployment. Expected result: the intended branch is present and there are no unexpected local edits.

Create unique staging-only credentials. Generate secrets with a cryptographically secure generator and keep them out of shell history and Git. For example, generate candidate values with:

```sh
openssl rand -hex 32
```

Expected result: a 64-character random hex value. Generate a different value for the staging database password, staging MySQL root password, and staging JWT secret. Do not reuse production credentials. Create `staging.env` using a protected editor/secret manager, set `STAGING_FRONTEND_URL` to the exact HTTPS origin, and set `STAGING_TRUST_PROXY=1` only when the app is directly behind the Nginx proxy described below. Set owner-only access:

```sh
sudo install -o root -g root -m 0600 /dev/null staging.env
sudoedit staging.env
sudo git check-ignore staging.env
```

Purpose: create a root-readable environment file without putting secret values in command arguments. Expected result: the file mode is `600` and Git reports `staging.env` as ignored. Keep a protected copy of these values for recovery; rotating JWT_SECRET logs out existing sessions.

Validate configuration without printing resolved secret values:

```sh
sudo docker compose -p vocabup-staging --env-file staging.env -f docker-compose.staging.yml config --quiet
```

Expected result: exit status zero and no output. If it fails, correct missing/invalid variables before starting containers.

## 3. Build and start staging

```sh
sudo docker compose -p vocabup-staging --env-file staging.env -f docker-compose.staging.yml build
sudo docker compose -p vocabup-staging --env-file staging.env -f docker-compose.staging.yml up -d
sudo docker compose -p vocabup-staging --env-file staging.env -f docker-compose.staging.yml ps
```

Purpose: build the multi-stage image and start the independent staging app/database. Expected result: MySQL becomes healthy, then the app becomes healthy; the app port is bound only to `127.0.0.1` and MySQL has no host port. The named `vocabup_staging_mysql` volume preserves staging data. Do not run `down -v`.

Inspect only recent operational logs (never paste them publicly without redaction) and verify health:

```sh
sudo docker compose -p vocabup-staging --env-file staging.env -f docker-compose.staging.yml logs --tail=100 app mysql
curl --fail http://127.0.0.1:4001/api/health
```

Expected result: app reports healthy and endpoint returns `{"status":"ok","database":"ok"}`. A database initialization script runs only for a new empty volume. Existing volumes are not migrated by the MySQL entrypoint; back up and review schema changes before applying a migration manually.

## 4. Configure Nginx and HTTPS

Point the staging DNS record to the VPS, then obtain a certificate with the organization's approved ACME/certificate process. Do not enable the HTTPS server block until certificate and private key exist. Render `deploy/nginx-vocabup.conf.template` into an Nginx site file by replacing `__DOMAIN__`, `__TLS_CERT_PATH__`, and `__TLS_KEY_PATH__` with the real staging values. For staging, change its upstream port from `4000` to `4001` (or deliberately configure `STAGING_APP_PORT=4000`); the template's default `4000` is for production. Do not commit the rendered file or private key. The template redirects HTTP to HTTPS, accepts TLS 1.2/1.3, overwrites forwarded host/proto/client headers, and enables HSTS only in the TLS server block.

```sh
sudo nginx -t
sudo systemctl reload nginx
```

Purpose: syntax-check then activate the proxy configuration. Expected result: `nginx -t` succeeds and Nginx reload succeeds. If certificate issuance or syntax validation fails, do not claim HTTPS is active. Confirm firewall ingress permits 80/443 and blocks direct public access to the app and MySQL.

Set `STAGING_FRONTEND_URL=https://<staging-hostname>` exactly and `STAGING_TRUST_PROXY=1` only with this directly connected trusted Nginx. Nginx must be the only ingress to `127.0.0.1:4001`; if there is another load balancer in front, re-evaluate the trusted proxy chain rather than blindly increasing trust. App cookies are HttpOnly and SameSite=Strict; Secure is set in `NODE_ENV=production`, so staging must be served over HTTPS when testing production-mode cookie behavior.

Verify after DNS and certificate setup:

```sh
curl -sSI http://<staging-hostname>/
curl -sSI https://<staging-hostname>/
curl -sSI https://<staging-hostname>/api/health
```

Expected result: HTTP responds with a redirect to HTTPS; HTTPS serves the site and health endpoint; the HTTPS response includes HSTS. Also test register/login/logout in a real browser. These checks must be run on the actual VPS before marking TLS verified.

## 5. Database privileges

The schema consists of `users`, `decks`, `cards`, and `reviews` from `backend/migrations/001_initial.sql`. Runtime routes need `SELECT`, `INSERT`, `UPDATE`, and `DELETE` on those tables. The migration creates tables and conditionally adds columns, so it needs `CREATE`, `ALTER`, and metadata reads. On a new volume, the Compose bootstrap applies `deploy/mysql/*-runtime-privileges.sql` after schema creation to revoke the MySQL image's broad initial grant and leave CRUD permissions for the runtime user. For an already initialized volume, init scripts do not rerun; inspect `SHOW GRANTS` and apply the same reviewed privilege reduction through a DBA session after confirming it will not interrupt a concurrent migration.

Before exposing staging, provision a dedicated runtime account with only CRUD rights and a separate migration account used only during controlled migration windows. Example grants (replace account names and database name using a secure DBA session; do not put passwords in this file):

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON vocabup_staging.* TO 'vocabup_staging_app'@'%';
GRANT SELECT, CREATE, ALTER, INDEX, REFERENCES ON vocabup_staging.* TO 'vocabup_staging_migrator'@'%';
```

The migration account also needs whatever `information_schema` access the MySQL version provides by default. Do not grant `DROP`, `GRANT OPTION`, global privileges, or root to the runtime app. The current migration command uses `DB_USER`; the image contains compiled `backend/dist/migrate.js`, so run it with the migration account in a one-off controlled app container after the migration user is provisioned, then recreate the app with its runtime credentials. Validate effective grants with `SHOW GRANTS` on the actual VPS. For an existing volume, first inspect grants and take a verified backup; do not assume the first-init privilege script ran.

## 6. Backups, retention, and restore

Schedule encrypted backups at least daily initially, then set frequency and retention from an explicit recovery point/time objective. Keep multiple generations (example: 7 daily, 4 weekly, 12 monthly), encrypt before transfer, and copy to access-controlled storage outside the VPS. Store the decryption key separately. Alert on failed or stale backups, disk capacity, and restore-test failures. The script `scripts/backup-staging.sh` requires `age` and `BACKUP_AGE_RECIPIENT`; it writes an encrypted SQL dump, an encrypted row-count manifest and a SHA-256 checksum for both. Pause application writes for the duration so the row-count manifest corresponds to the dump. Test it on staging before scheduling.

```sh
BACKUP_AGE_RECIPIENT='age1...' bash scripts/backup-staging.sh
```

Expected result: an `.sql.age` file and checksum are created under `backups/` with restrictive permissions. Upload the encrypted file and checksum to off-host storage using the organization's approved method; do not commit backups.

Restore tests use a separate Compose project and a uniquely named database in the test-only restore volume. They never connect to the staging or production Compose network. Provide an encrypted staging dump and a test-only MySQL root password:

```sh
RESTORE_TEST_ROOT_PASSWORD='unique-test-only-value' RESTORE_AGE_IDENTITY='/secure/path/age-identity.txt' bash scripts/restore-test.sh backups/vocabup-staging-YYYYMMDDTHHMMSSZ.sql.age
```

Expected result: checksum verification passes, a new database named `vocabup_restore_test_<timestamp>_<process-id>` is created in the isolated `vocabup_restore_test_mysql` volume, the dump decrypts/imports, all four row counts match the encrypted manifest, and `CHECK TABLE` reports `OK` for each table. The identity file stays outside the repository and its contents are never printed. The script deliberately does not delete containers, databases, or volumes. Keep restore-test data until an operator has inspected it; clean it only through a separately reviewed retention procedure.

## 7. Staging verification

Run the CI-equivalent checks from the checkout (with a separate MySQL test database, never staging data):

```sh
npm ci
npx tsc --noEmit -p backend/tsconfig.json
npm run test -w backend
npx tsc --noEmit -p frontend/tsconfig.json
npm run build -w frontend
npm audit --audit-level=high
npx playwright install chromium
npm run test:e2e
```

Expected result: every command exits zero. API integration tests require a separate MySQL database named exactly `vocabup_test`, and Playwright requires loopback `E2E_DB_HOST` plus `E2E_DB_PASSWORD`; configure these explicitly and never point them at staging or production. CI runs MySQL integration and Playwright against an ephemeral job-local database. Review screenshots/reports and test the actual VPS URL from browser viewport sizes before accepting staging.

## 8. Update staging

Review the new revision and migration first, then back up staging and verify the backup exists off-host. Deploy a reviewed revision:

```sh
git fetch origin
git switch <reviewed-branch>
git pull --ff-only
sudo docker compose -p vocabup-staging --env-file staging.env -f docker-compose.staging.yml build app
sudo docker compose -p vocabup-staging --env-file staging.env -f docker-compose.staging.yml up -d --no-deps app
sudo docker compose -p vocabup-staging --env-file staging.env -f docker-compose.staging.yml ps
curl --fail https://<staging-hostname>/api/health
```

Expected result: only the app image is rebuilt, MySQL volume is retained, and HTTPS health check succeeds. Do not update schema until a reviewed migration and verified backup are available.

## 9. Rollback

Keep the previous reviewed image/revision and its configuration. If the new app fails health or smoke checks, re-checkout the previous reviewed revision and recreate only the app:

```sh
git switch <previous-reviewed-branch-or-tag>
sudo docker compose -p vocabup-staging --env-file staging.env -f docker-compose.staging.yml build app
sudo docker compose -p vocabup-staging --env-file staging.env -f docker-compose.staging.yml up -d --no-deps app
curl --fail https://<staging-hostname>/api/health
```

Expected result: the previous app version is healthy while the database volume remains untouched. A database migration may not be reversible; restore a backup only into an isolated recovery target first and follow an approved recovery plan. Never use `docker compose down -v`, delete the named volume, or restore a dump over production as a rollback shortcut.

## 10. GitHub Actions

`.github/workflows/ci.yml` runs backend typecheck/unit tests, ephemeral MySQL integration tests, Playwright Chromium, frontend typecheck/build, and `npm audit`. It has no deployment job. CI's disposable credentials are for that isolated runner only. Confirm the workflow succeeds on GitHub before staging; local success does not prove GitHub Actions succeeded.
