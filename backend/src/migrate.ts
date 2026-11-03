import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { DEFAULT_DAILY_NEW_LIMIT } from './config.js';
const migrationsUrl = new URL('../migrations/', import.meta.url);
const sqlFiles = (await readdir(fileURLToPath(migrationsUrl))).filter(file => file.endsWith('.sql')).sort();

const connection = await mysql.createConnection({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 3306),
  database: process.env.DB_NAME ?? 'vocabup',
  user: process.env.DB_USER ?? 'vocabup',
  password: process.env.DB_PASSWORD ?? 'vocabup',
  multipleStatements: true,
});

/** Columns are added conditionally because MySQL has no `ADD COLUMN IF NOT EXISTS`. */
const columnAdditions = [
  ['cards', 'pronunciation', "VARCHAR(500) NOT NULL DEFAULT ''"],
  ['cards', 'translation', 'TEXT NULL'],
  ['decks', 'daily_new_limit', `INT UNSIGNED NOT NULL DEFAULT ${DEFAULT_DAILY_NEW_LIMIT}`],
  ['users', 'role', "ENUM('user','admin') NOT NULL DEFAULT 'user'"],
  ['users', 'status', "ENUM('active','locked') NOT NULL DEFAULT 'active'"],
  ['users', 'last_active_at', 'TIMESTAMP NULL DEFAULT NULL'],
  ['decks', 'is_public', 'TINYINT(1) NOT NULL DEFAULT 0'],
  ['decks', 'is_favorite', 'TINYINT(1) NOT NULL DEFAULT 0'],
  ['cards', 'image_url', 'VARCHAR(2048) NULL'],
  ['cards', 'image_thumbnail_url', 'VARCHAR(2048) NULL'],
  ['cards', 'image_source', 'VARCHAR(24) NULL'],
  ['cards', 'image_author', 'VARCHAR(255) NULL'],
  ['cards', 'image_source_url', 'VARCHAR(2048) NULL'],
  ['cards', 'image_license', 'VARCHAR(160) NULL'],
  ['cards', 'image_license_url', 'VARCHAR(2048) NULL'],
  ['cards', 'image_query', 'VARCHAR(200) NULL'],
  ['cards', 'image_status', "ENUM('none','pending','ready','error') NOT NULL DEFAULT 'none'"],
  ['cards', 'image_is_manual', 'TINYINT(1) NOT NULL DEFAULT 0'],
  ['cards', 'image_is_fallback', 'TINYINT(1) NOT NULL DEFAULT 0'],
  ['cards', 'image_retry_count', 'INT UNSIGNED NOT NULL DEFAULT 0'],
  ['cards', 'image_retry_at', 'TIMESTAMP NULL DEFAULT NULL'],
  ['cards', 'image_updated_at', 'TIMESTAMP NULL DEFAULT NULL'],
] as const;

/** Secondary indexes for administrator statistics/search, created only when missing. */
const indexAdditions = [
  ['users', 'idx_users_role_status', '(role, status)'],
  ['users', 'idx_users_created_at', '(created_at)'],
  ['users', 'idx_users_last_active_at', '(last_active_at)'],
  ['decks', 'idx_decks_is_public', '(is_public)'],
  ['decks', 'idx_decks_user_favorite', '(user_id, is_favorite)'],
  ['decks', 'idx_decks_created_at', '(created_at)'],
  ['reviews', 'idx_reviews_reviewed_at', '(reviewed_at)'],
  ['reviews', 'idx_reviews_user_rating_date', '(user_id, rating, reviewed_at)'],
  ['reviews', 'idx_reviews_card_rating_date', '(card_id, rating, reviewed_at)'],
  ['cards', 'idx_cards_image', '(deck_id, image_status)'],
] as const;

try {
  for (const file of sqlFiles) {
    const sql = await readFile(new URL(file, migrationsUrl), 'utf8');
    await connection.query(sql);
  }
  for (const [table, column, definition] of columnAdditions) {
    const [rows] = await connection.query(
      'SELECT COUNT(*) AS count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?', [table, column],
    ) as unknown as [Array<{ count: number }>, unknown];
    if (Number(rows[0]?.count ?? 0) === 0) await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  }
  for (const [table, index, definition] of indexAdditions) {
    const [rows] = await connection.query(
      'SELECT COUNT(*) AS count FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=?', [table, index],
    ) as unknown as [Array<{ count: number }>, unknown];
    if (Number(rows[0]?.count ?? 0) === 0) await connection.query(`ALTER TABLE \`${table}\` ADD INDEX \`${index}\` ${definition}`);
  }
  // Schema only: migrations never modify existing decks or their cards.
  console.log(`Database migration applied (${sqlFiles.length} SQL file(s), ${columnAdditions.length} column checks, ${indexAdditions.length} index checks).`);
} finally {
  await connection.end();
}
