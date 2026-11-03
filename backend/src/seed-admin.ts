import 'dotenv/config';
import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';

/**
 * Bootstrap/promote an administrator without ever hardcoding credentials.
 *
 *   ADMIN_EMAIL=admin@example.com ADMIN_NAME="Platform Admin" \
 *   ADMIN_PASSWORD='<strong password>' npm run admin:create -w backend
 *
 * The script is idempotent: an existing account with that email is promoted and
 * has its password reset; otherwise a new admin account is created. It never
 * logs the password and requires a strong, operator-supplied secret.
 */

const email = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
const name = (process.env.ADMIN_NAME ?? 'Administrator').trim().slice(0, 100);
const password = process.env.ADMIN_PASSWORD ?? '';

function fail(message: string): never {
  console.error(`[vocabup] ${message}`);
  process.exit(1);
}

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  fail('ADMIN_EMAIL must be a valid email address (set it in the environment).');
}
if (password.length < 12 || password.length > 72) {
  fail('ADMIN_PASSWORD must contain 12–72 characters. Provide it through the environment; never commit it.');
}
const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(pattern => pattern.test(password)).length;
if (classes < 3) {
  fail('ADMIN_PASSWORD must mix at least three of: lowercase, uppercase, digits, symbols.');
}

const connection = await mysql.createConnection({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 3306),
  database: process.env.DB_NAME ?? 'vocabup',
  user: process.env.DB_USER ?? 'vocabup',
  password: process.env.DB_PASSWORD ?? 'vocabup',
});

try {
  const hash = await bcrypt.hash(password, 12);
  const [rows] = await connection.execute('SELECT id FROM users WHERE email = ?', [email]);
  const existing = (rows as Array<{ id: number }>)[0];
  if (existing) {
    await connection.execute("UPDATE users SET name = ?, password_hash = ?, role = 'admin', status = 'active' WHERE id = ?", [name, hash, existing.id]);
    console.log(`[vocabup] Promoted existing account ${email} to admin (password reset).`);
  } else {
    await connection.execute("INSERT INTO users (name, email, password_hash, role, status) VALUES (?, ?, ?, 'admin', 'active')", [name, email, hash]);
    console.log(`[vocabup] Created administrator ${email}.`);
  }
  console.log('[vocabup] Sign in at /login and open /admin. The password is not logged.');
} catch (error) {
  fail(`Could not create the administrator: ${(error as Error).message}`);
} finally {
  await connection.end();
}
