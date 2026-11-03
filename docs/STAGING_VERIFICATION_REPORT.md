# VocabUp staging verification report

**Date:** 2026-11-02  
**Scope:** Local Windows workspace and disposable test configuration only. No deployment, production database access, service stop, firewall change, volume deletion, commit, or push was performed.

## Summary

**Staging status: BLOCKED / NOT READY.** Docker Desktop is not installed in the visible Windows environment, so there is no Docker daemon or isolated MySQL test database. Unit/build checks, online npm audit, Git remote comparison, Compose static validation, Playwright package/browser launch, and Bash parse checks succeeded. The MySQL integration suite and app E2E suite were attempted and failed at the database health/register steps because no test database was listening on loopback port 3307. Backup and restore were syntax-checked but not executed.

## Docker and container runtime

### VERIFIED

- `docker version`: Docker CLI 29.8.2, API 1.56, Windows/amd64.
- `docker context ls`: selected context is `desktop-linux`, endpoint `npipe:////./pipe/dockerDesktopLinuxEngine`; a second `default` context points at `npipe:////./pipe/docker_engine`.
- `docker compose version`: Docker Compose v5.5.1. `docker buildx version`: v0.37.2.
- `docker desktop status`: “Could not retrieve status. Is Docker Desktop running?”
- `docker desktop start`: failed because the registry key `SOFTWARE\Docker Inc\Docker Desktop` could not be found.
- Checks for the standard per-machine and per-user Docker Desktop executables and HKLM/HKCU registration both found them absent. No matching Docker Desktop/backend process was observed.
- `docker info` cannot reach the selected daemon: `permission denied` on `npipe:////./pipe/dockerDesktopLinuxEngine`.
- Buildx lock: `C:\Users\hbao1\.docker\buildx\.lock` exists, is zero bytes, and its ACL lists the current account with FullControl. Opening it read/write-exclusive from this sandbox is denied. `docker build` failed with `Access is denied` for this lock. The lock was not removed or altered.
- WSL reports version 3.0.3 and kernel 6.18.54.1. `wsl.exe --status` and `wsl.exe -l -v` returned `Wsl/E_ACCESSDENIED`; installed distro/integration state is therefore unknown.
- Staging, production, and isolated restore-test `docker compose ... config --quiet` validations all exited successfully. This checks interpolation and syntax only; it does not start services.

### NOT VERIFIED / BLOCKED

- Production image build, image user, container health, restart policy, read-only rootfs/capabilities, staging startup, internal app-to-MySQL networking, and host port exposure cannot be runtime-verified without Docker Engine.
- No Docker data or named volume was inspected, started, removed, or reset.

### Next action

Install Docker Desktop using the official [Windows installation guide](https://docs.docker.com/desktop/setup/install/windows-install/) (the per-user mode is documented under `%LOCALAPPDATA%\Programs\DockerDesktop`). Start it from the Windows Start menu, select the WSL 2 Linux engine, and verify `docker desktop status`, `docker info`, and `docker context ls`. Docker documents WSL 2.1.5+ as the minimum for its WSL backend in its [WSL backend guide](https://docs.docker.com/desktop/features/wsl). Do not delete the Docker data directory or reset Docker Desktop as a troubleshooting shortcut.

## MySQL test database and integration

### VERIFIED

- `Test-NetConnection 127.0.0.1 -Port 3307`: `TcpTestSucceeded=False`.
- Integration test was launched with `RUN_API_INTEGRATION=1`, `NODE_ENV=test`, `DB_NAME=vocabup_test`, loopback host `127.0.0.1:3307`, a test-only runtime username, and a disposable password.
- API integration suite failed its setup health check with `Test API is not healthy against MySQL.`; all six test cases were skipped after setup failure. No real database accepted a connection.
- The E2E suite independently received the API error “Dịch vụ dữ liệu tạm thời không khả dụng.” during registration, consistent with the unavailable MySQL test service.
- Existing Windows MySQL80 on port 3306 was deliberately not used because it is not the isolated `vocabup_test` database and may hold user data.

### CODE REVIEWED

- On first initialization, `deploy/mysql/staging-runtime-privileges.sql` revokes the MySQL image's initial broad schema grant and grants the staging runtime user only `SELECT`, `INSERT`, `UPDATE`, `DELETE` on `vocabup_staging.*`. Production has an equivalent file for `vocabup.*`.
- MySQL entrypoint init scripts only run against an empty data directory. They do not alter grants on an existing named volume.
- The application migration needs schema creation/alter privileges. Operations documentation calls for a separate migration account used only for a controlled migration.

### NOT VERIFIED / BLOCKED

- MySQL service health, migration execution, `SHOW GRANTS`, and runtime least-privilege behavior were not tested against MySQL.
- No grants were changed on any existing database or volume. A database administrator must review grants on an actual staging volume before applying a separate permission migration.

## Playwright and browser

### VERIFIED

- `npm ls @playwright/test --depth=0`: `@playwright/test@1.64.1`; this version is already in the repository lockfile. `npm install --no-save --ignore-scripts` installed/synchronized ignored `node_modules` without changing package manifests.
- `npx playwright test --list` found two tests: the full auth/deck/vocabulary/study/SRS/statistics/logout flow and responsive dashboard/sidebar/modal checks.
- Chromium Headless Shell 156.0.8078.4 installed under ignored `artifacts/playwright/browsers/`.
- Browser smoke launched Chromium, opened a local `data:` page, and reported title `browser-smoke` at viewport 375x812.
- `npm run test:e2e` was run against `vocabup_test` on loopback only. Result: **2 failed**, both at registration before the app workflows or responsive viewport loop could continue. The UI displayed the database unavailable error; this is not a passing E2E run.
- Failure screenshots, videos, traces, and HTML report were generated under ignored `artifacts/playwright/`. Example evidence: `artifacts/playwright/results/vocabup-register-login-das-61f3b-y-SRS-statistics-and-logout/test-failed-1.png` and its `trace.zip`.

### NOT VERIFIED / BLOCKED

- Registration-to-logout application behavior, viewport sizes 375/390/768/1366/1920, console/network diagnostics through completion, overflow and modal assertions did not complete because the app had no test database.

## Backup and restore

### VERIFIED

- Bash parse-only checks succeeded for `scripts/backup-staging.sh` and `scripts/restore-test.sh` using `bash -n`.
- Static inspection confirms backup streams `mysqldump` into `age`, stores a separately encrypted row-count manifest, and writes checksums. Restore checks checksums, decrypts to a unique database inside a separate internal-only test Compose project, compares table row counts, runs `CHECK TABLE`, and does not remove containers, databases, or volumes.
- Backup output and generated artifacts are ignored by Git and excluded from Docker build context.

### NOT VERIFIED / BLOCKED

- No staging MySQL was available, so no backup was taken, checksum verified, encrypted file decrypted, restore imported, row counts compared, or table check executed.
- Backup frequency, off-host destination, retention, and age identity custody remain operational tasks.

## Build, unit checks, audit, and Compose

### VERIFIED

- `npx tsc --noEmit -p backend/tsconfig.json`: pass.
- `npm run test -w backend`: 22 passed, 6 integration tests skipped by the unit suite.
- `npm run build -w backend`: pass.
- `npx tsc --noEmit -p frontend/tsconfig.json`: pass.
- `npm run build -w frontend`: pass; Vite output included 268.91 kB JS (82.95 kB gzip).
- `npm audit --audit-level=high`: online run succeeded with `found 0 vulnerabilities`.
- `npm ci --dry-run --ignore-scripts`: “up to date”; lockfile install plan is consistent. No `package.json` or `package-lock.json` change was made by the Playwright installation in this verification pass.
- `git diff --check`: pass (line-ending warnings only).
- Compose config syntax checks for staging, production, and restore-test succeeded.

### NOT VERIFIED / BLOCKED

- Docker image build remains blocked by absent Docker Desktop/daemon and Buildx lock access. Compose config success is not evidence that a container starts.

## GitHub and secret hygiene

### VERIFIED

- `origin` is `https://github.com/ntbhow/VocabUp.git`; current branch is `main`, local `HEAD` is `706ff9779726a9d4e5b5a73afb57fb73df051f14`.
- After `git fetch origin`, `git rev-list --left-right --count main...origin/main` returned `0 0`; local `main` and `origin/main` are equal at fetch time.
- User confirmed the specific hostname added in `frontend/vite.config.ts` is approved for public GitHub.
- `backend/.env` exists locally but is ignored by `.gitignore`; it was not read or staged. Only `.env.example` files appear in the tracked paths. A targeted private-key/common-token pattern scan of nonignored repository files returned no matches; the ignored `.env` file was intentionally not scanned.
- No staged files existed; no commit or push occurred. GitHub Actions was not triggered.

### NOT VERIFIED

- No GitHub Actions run status exists for this workspace change because nothing was pushed.
- This was a targeted pattern scan, not a full historical secret scanner. Remote history outside fetched branch refs was not audited.

## Files changed in this verification pass

- `docs/STAGING_VERIFICATION_REPORT.md` (this report)
- `scripts/backup-staging.sh`
- `scripts/restore-test.sh`
- `docs/PRODUCTION_OPERATIONS.md`

Prior uncommitted files remain untouched. Generated Playwright artifacts and browser binaries remain ignored. No dependency manifest/lockfile edits, commits, pushes, deployments, or data cleanup occurred in this pass.

## Readiness verdict

**STAGING READY: NO.** Required runtime evidence is missing for Docker image/container, isolated MySQL health/migrations/grants, integration tests, successful browser workflows/responsive checks, and backup/restore. First install and start Docker Desktop, then use only the dedicated staging/test Compose projects and rerun the blocked checks. HTTPS/proxy must be verified on a staging host with its real staging domain/certificate. This verdict makes no production readiness claim.
