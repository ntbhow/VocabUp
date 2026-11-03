## UI and profile update

Shared visual tokens and components live in `frontend/src/design.css`, `Account.tsx`, and `StudyCard.tsx`. Existing layout and feature styles remain in `style.css` and `admin/admin.css`. No new runtime dependency was added.

Profile persistence requires `backend/migrations/004_user_profiles.sql`. This change only prepares the migration; it does not run it. Apply it through the project's deployment process after approval. Until it is applied, the profile editor cannot load or save. Existing learning features continue using their existing endpoints.

The new `/api/users/me` routes use the existing session authentication. Profile updates accept only `name` and `bio`. Email is read-only; no username or email verification flow has been introduced. Avatar upload uses the existing signature validation and a 2 MB request limit. Uploads and text are separate requests; if the avatar request fails after text was saved, the editor retains the pending avatar and reports the error. Removed/replaced avatar files are retained on disk; the profile stops referencing them.

Validation: root build includes backend and frontend TypeScript checking. Targeted auth/upload/scheduling/queue and profile validation unit tests do not access a database. `node scripts/check-ui-refresh.mjs` starts a temporary frontend, blocks all API requests, and captures login/register at 1440, 820, and 390 pixels. It uses installed Edge. Authenticated pages and profile persistence still need a deployment with the migration applied and permission to access a test database. No live data was read or changed during this work.
