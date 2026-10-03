/**
 * Capa de acceso a datos — dual driver.
 *
 * Driver por defecto: `node:sqlite` (built-in de Node 24, cero dependencias).
 * Si existe `DATABASE_URL`, se usa **Postgres** vía `pg` (Pool).
 *
 * Contrato (igual para ambos drivers):
 *  - Los 3 helpers (`queryAll`, `queryOne`, `run`) son `async` y reciben SQL
 *    plano con placeholders posicionales `?`. En Postgres se convierten a
 *    `$1, $2, ...` dentro del helper, así que las rutas no cambian.
 *  - `run` devuelve `{ id, changes }`. En Postgres, los INSERT agregan
 *    `RETURNING id` automáticamente.
 *  - Columnas JSON: se guardan como TEXT con JSON.stringify/parse en AMBOS
 *    drivers (en Postgres podrían ser JSONB: mejora futura, ver schema.pg.sql).
 *  - Booleanos: 0/1 (INTEGER) en ambos drivers, para que el SQL sea idéntico.
 *  - `created_at`: string 'AAAA-MM-DD HH:MM:SS' en ambos (en Postgres se
 *    genera con `to_char(now(), ...)`).
 *
 * Ninguna ruta toca la DB directamente: solo usan estos helpers vía `req.db`.
 */
'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const USE_PG = Boolean(process.env.DATABASE_URL);

/**
 * Abre la base. Con DATABASE_URL → handle de Postgres `{ __pg: true, pool }`
 * (el Pool conecta de forma perezosa). Sin ella → DatabaseSync de SQLite.
 */
function openDb(filePath) {
  if (USE_PG) {
    // eslint-disable-next-line global-require
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX || 10),
      // PG_SSL=true para proveedores con SSL autofirmado (ej. algunos PaaS).
      ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    });
    pool.on('error', (err) => console.error('[oppi-api][pg] error del pool:', err.message));
    return { __pg: true, pool };
  }
  if (filePath && filePath !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  }
  const db = new DatabaseSync(filePath || ':memory:');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

const isPg = (db) => Boolean(db && db.__pg);

/** Convierte placeholders `?` posicionales a `$1, $2, ...` (Postgres). */
function toPgPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${(i += 1)}`);
}

/**
 * Migración de la tabla notifications en DBs SQLite viejas: el CHECK de `type`
 * original no incluía los tipos nuevos ('offer','quote','job','review','support').
 * SQLite no permite ALTER CHECK: se reconstruye la tabla preservando los datos.
 */
function ensureNotificationTypes(db) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'notifications'").get();
  if (row && row.sql && !row.sql.includes("'support'")) {
    db.exec(`
      CREATE TABLE notifications_new (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type         TEXT NOT NULL CHECK (type IN ('reminder','review_request','waitlist','booking','referral','offer','quote','job','review','support')),
        title        TEXT NOT NULL,
        body         TEXT DEFAULT '',
        read         INTEGER NOT NULL DEFAULT 0,
        scheduled_for TEXT,
        push_sent    INTEGER NOT NULL DEFAULT 0,
        push_sent_at TEXT,
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO notifications_new (id, user_id, type, title, body, read, scheduled_for, created_at)
        SELECT id, user_id, type, title, body, read, scheduled_for, created_at FROM notifications;
      DROP TABLE notifications;
      ALTER TABLE notifications_new RENAME TO notifications;
      CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read);
    `);
  }
  const cols = db.prepare('PRAGMA table_info(notifications)').all().map((c) => c.name);
  if (!cols.includes('push_sent')) db.exec('ALTER TABLE notifications ADD COLUMN push_sent INTEGER NOT NULL DEFAULT 0');
  if (!cols.includes('push_sent_at')) db.exec('ALTER TABLE notifications ADD COLUMN push_sent_at TEXT');
}

/** Aplica el DDL (idempotente: CREATE TABLE IF NOT EXISTS). */
async function migrate(db) {
  const { seedTaxonomy, mapLegacyTaxonomy } = require('./taxonomy');
  if (isPg(db)) {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.pg.sql'), 'utf8');
    await db.pool.query(schema);
    await ensureExtraColumnsPg(db);
    await seedTaxonomy(db);
    await mapLegacyTaxonomy(db);
    return;
  }
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  ensureNotificationTypes(db);
  ensureBookingStatusCheck(db);
  ensurePaymentsKindCheck(db);
  ensureExtraColumnsSqlite(db);
  ensureNullableUserEmail(db);
  await seedTaxonomy(db);
  await mapLegacyTaxonomy(db);
}

/**
 * Migración de la tabla bookings en DBs SQLite viejas: el CHECK de `status`
 * original no incluía 'no_show_client' ni 'no_show_pro'. SQLite no permite
 * ALTER CHECK: se reconstruye la tabla preservando los datos. Se apagan las
 * FKs durante la operación porque jobs/reviews referencian a bookings.
 */
function ensureBookingStatusCheck(db) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'bookings'").get();
  if (!row || !row.sql || row.sql.includes("'no_show_client'")) return;
  db.exec('PRAGMA foreign_keys = OFF;');
  try {
    db.exec(`
      CREATE TABLE bookings_new (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id        INTEGER NOT NULL REFERENCES users(id),
        service_id       INTEGER NOT NULL REFERENCES services(id),
        slot_id          INTEGER REFERENCES slots(id),
        status           TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','confirmed','completed','cancelled','no_show_client','no_show_pro')),
        deposit_gs       INTEGER NOT NULL DEFAULT 0,
        deposit_paid     INTEGER NOT NULL DEFAULT 0,
        total_gs         INTEGER NOT NULL,
        credit_applied_gs INTEGER NOT NULL DEFAULT 0,
        created_at       TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO bookings_new (id, client_id, service_id, slot_id, status, deposit_gs, deposit_paid, total_gs, credit_applied_gs, created_at)
        SELECT id, client_id, service_id, slot_id, status, deposit_gs, deposit_paid, total_gs, credit_applied_gs, created_at FROM bookings;
      DROP TABLE bookings;
      ALTER TABLE bookings_new RENAME TO bookings;
      CREATE INDEX IF NOT EXISTS idx_bookings_client ON bookings(client_id);
    `);
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

/**
 * Migración de users.email a NULLABLE en DBs SQLite viejas (eliminar cuenta
 * anonimiza el email a NULL, pieza "lista para lanzar" 3). SQLite no permite
 * ALTER COLUMN: se reconstruye la tabla preservando los datos. Se apagan las
 * FKs porque muchas tablas referencian a users.
 */
function ensureNullableUserEmail(db) {
  const cols = db.prepare('PRAGMA table_info(users)').all();
  const emailCol = cols.find((c) => c.name === 'email');
  if (!emailCol || emailCol.notnull === 0) return;
  db.exec('PRAGMA foreign_keys = OFF;');
  try {
    db.exec(`
      CREATE TABLE users_new (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        name          TEXT NOT NULL,
        email         TEXT UNIQUE,
        phone         TEXT,
        barrio        TEXT DEFAULT '',
        foto_url      TEXT DEFAULT '',
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL DEFAULT 'client' CHECK (role IN ('client','pro','handyman','business')),
        referral_code TEXT NOT NULL UNIQUE,
        credit_gs     INTEGER NOT NULL DEFAULT 0,
        suspended     INTEGER NOT NULL DEFAULT 0,
        no_show_count INTEGER NOT NULL DEFAULT 0,
        featured_until TEXT,
        is_admin      INTEGER NOT NULL DEFAULT 0,
        terms_accepted_at TEXT,
        deleted_at    TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO users_new (id, name, email, phone, barrio, foto_url, password_hash, role,
                             referral_code, credit_gs, suspended, no_show_count, featured_until,
                             is_admin, terms_accepted_at, deleted_at, created_at)
        SELECT id, name, email, phone, barrio, foto_url, password_hash, role,
               referral_code, credit_gs, suspended, no_show_count, featured_until,
               is_admin, terms_accepted_at, deleted_at, created_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `);
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

/**
 * Columnas agregadas después del schema inicial (perfil + geolocalización).
 * Tolerante: solo agrega la columna si no existe (DBs viejas de dev).
 * Nombres de tabla/columna fijos e internos: la interpolación es segura.
 */
const EXTRA_COLUMNS = [
  ['users', 'barrio', "TEXT DEFAULT ''"],
  ['users', 'foto_url', "TEXT DEFAULT ''"],
  ['professionals', 'lat', 'REAL'],
  ['professionals', 'lng', 'REAL'],
  ['businesses', 'lat', 'REAL'],
  ['businesses', 'lng', 'REAL'],
  ['businesses', 'cancel_free_hours', 'INTEGER NOT NULL DEFAULT 24'],
  ['businesses', 'min_advance_hours', 'INTEGER'],
  ['professionals', 'no_show_count', 'INTEGER NOT NULL DEFAULT 0'],
  // Cupones (mejora 4): columnas nuevas de bookings para DBs viejas
  // (los CREATE TABLE IF NOT EXISTS del schema las cubren en DBs nuevas).
  ['bookings', 'coupon_id', 'INTEGER REFERENCES coupons(id)'],
  ['bookings', 'discount_gs', 'INTEGER NOT NULL DEFAULT 0'],
  // Mejoras 5-8: columna de aviso "voy en camino" en bookings,
  // fotos en reviews y fecha de canje en referral_redemptions.
  ['bookings', 'en_route_at', 'TEXT'],
  ['reviews', 'photos', "TEXT NOT NULL DEFAULT '[]'"],
  ['referral_redemptions', 'created_at', 'TEXT'],
  // Nueva política de cancelación (piloto): suspensión, no-shows, comodines,
  // puntos y columnas de auditoría de cancelación en bookings.
  // (Los CREATE TABLE IF NOT EXISTS del schema cubren DBs nuevas y las
  // tablas wildcards/points_ledger; acá solo van columnas de tablas viejas.)
  ['users', 'suspended', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'no_show_count', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'featured_until', 'TEXT'],
  // Panel admin + TyC + eliminar cuenta (piezas "lista para lanzar" 1-3).
  ['users', 'is_admin', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'terms_accepted_at', 'TEXT'],
  ['users', 'deleted_at', 'TEXT'],
  ['professionals', 'suspended', 'INTEGER NOT NULL DEFAULT 0'],
  ['professionals', 'featured_until', 'TEXT'],
  ['businesses', 'suspended', 'INTEGER NOT NULL DEFAULT 0'],
  ['businesses', 'no_show_count', 'INTEGER NOT NULL DEFAULT 0'],
  // Chambas handyman: geolocalización de la tarea (se suma a lo que ya
  // tienen professionals y businesses).
  ['tasks', 'lat', 'REAL'],
  ['tasks', 'lng', 'REAL'],
  ['bookings', 'confirmed_at', 'TEXT'],
  ['bookings', 'free_until', 'TEXT'],
  ['bookings', 'cancel_reason', 'TEXT'],
  ['bookings', 'cancel_detail', 'TEXT'],
  ['bookings', 'cancelled_by', 'TEXT'],
  ['bookings', 'cancelled_at', 'TEXT'],
  ['bookings', 'wildcard_used', 'INTEGER NOT NULL DEFAULT 0'],
  ['bookings', 'free_cancel', 'INTEGER NOT NULL DEFAULT 0'],
  ['bookings', 'no_show_kind', 'TEXT'],
  ['bookings', 'reschedule_count', 'INTEGER NOT NULL DEFAULT 0'],
  ['bookings', 'rescheduled_at', 'TEXT'],
  ['bookings', 'points_gs', 'INTEGER NOT NULL DEFAULT 0'],
  // Mejoras 1, 2 y 7: sucursales, detalle de servicio y taxonomía.
  // (Los CREATE TABLE IF NOT EXISTS del schema las cubren en DBs nuevas;
  // acá solo van columnas de tablas viejas.)
  ['services', 'photo_url', 'TEXT'],
  ['services', 'description', 'TEXT'],
  ['services', 'includes', "TEXT NOT NULL DEFAULT '[]'"],
  ['bookings', 'branch_id', 'INTEGER REFERENCES branches(id)'],
  ['professionals', 'profession_id', 'INTEGER REFERENCES professions(id)'],
  ['businesses', 'category_id', 'INTEGER REFERENCES categories(id)'],
  // Cobro del 100% (2026-10): columnas nuevas de cobro en bookings y jobs
  // (las deposit_* quedan deprecadas pero se conservan por historial).
  ['bookings', 'paid_gs', 'INTEGER NOT NULL DEFAULT 0'],
  ['bookings', 'paid', 'INTEGER NOT NULL DEFAULT 0'],
  ['jobs', 'paid_gs', 'INTEGER NOT NULL DEFAULT 0'],
  // Roles en empresas (pieza 6): cuenta vinculada + permiso de acceso.
  ['team_members', 'user_id', 'INTEGER REFERENCES users(id) ON DELETE SET NULL'],
  ['team_members', 'permiso', "TEXT NOT NULL DEFAULT 'lectura' CHECK (permiso IN ('admin','editor','lectura'))"],
  // Verificaciones del panel admin (pieza 1): motivo del último rechazo.
  ['businesses', 'verification_note', 'TEXT'],
  ['professionals', 'verification_note', 'TEXT'],
  // Equipo IA (2026-10): verificador (archivo del documento) y moderador
  // (estado de moderación de reseñas). Las tablas prospects, content_drafts
  // y agent_runs las cubren los CREATE TABLE IF NOT EXISTS.
  ['business_documents', 'file_url', 'TEXT'],
  ['business_documents', 'file_size', 'INTEGER'],
  ['reviews', 'moderation_status', "TEXT NOT NULL DEFAULT 'approved'"],
  ['reviews', 'moderation_reason', 'TEXT'],
  // Equipo IA (2026-10): guardián de calidad — logo y descripción del negocio
  // para el score de completitud (DBs nuevas lo traen en el CREATE TABLE).
  ['businesses', 'logo_url', "TEXT DEFAULT ''"],
  ['businesses', 'description', "TEXT DEFAULT ''"],
];

function ensureExtraColumnsSqlite(db) {
  const known = {};
  for (const [table, column, ddl] of EXTRA_COLUMNS) {
    if (!known[table]) {
      known[table] = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    }
    if (!known[table].has(column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
      known[table].add(column);
    }
  }
}

async function ensureExtraColumnsPg(db) {
  for (const [table, column, ddl] of EXTRA_COLUMNS) {
    await db.pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${ddl}`);
  }
  // Eliminar cuenta anonimiza el email a NULL (pieza "lista para lanzar" 3).
  await db.pool.query('ALTER TABLE users ALTER COLUMN email DROP NOT NULL');
  // Cobro del 100% (2026-10): el CHECK de payments.kind pasó de
  // ('deposit_hold','refund') a ('charge','refund').
  await db.pool.query('ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_kind_check');
  await db.pool.query("ALTER TABLE payments ADD CONSTRAINT payments_kind_check CHECK (kind IN ('charge','refund'))");
}

/**
 * Migración de la tabla payments en DBs SQLite viejas: el CHECK de `kind`
 * era ('deposit_hold','refund'); ahora es ('charge','refund'). SQLite no
 * permite ALTER CHECK: se reconstruye la tabla preservando los datos.
 * (Ninguna tabla referencia a payments, así que no hay que tocar FKs.)
 */
function ensurePaymentsKindCheck(db) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'payments'").get();
  if (!row || !row.sql || !row.sql.includes("'deposit_hold'")) return;
  db.exec(`
    CREATE TABLE payments_new (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      reference_type      TEXT NOT NULL,
      reference_id        INTEGER NOT NULL,
      provider            TEXT NOT NULL DEFAULT 'mock',
      provider_payment_id TEXT,
      kind                TEXT NOT NULL DEFAULT 'charge'
                          CHECK (kind IN ('charge','refund')),
      amount_gs           INTEGER NOT NULL CHECK (amount_gs >= 0),
      status              TEXT NOT NULL DEFAULT 'captured'
                          CHECK (status IN ('pending','held','captured','released','refunded','failed')),
      created_at          TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO payments_new (id, reference_type, reference_id, provider, provider_payment_id,
                              kind, amount_gs, status, created_at)
      SELECT id, reference_type, reference_id, provider, provider_payment_id,
             kind, amount_gs, status, created_at FROM payments;
    DROP TABLE payments;
    ALTER TABLE payments_new RENAME TO payments;
    CREATE INDEX IF NOT EXISTS idx_payments_ref ON payments(reference_type, reference_id);
  `);
}

/** Devuelve todas las filas como objetos. */
async function queryAll(db, sql, params = []) {
  if (isPg(db)) {
    const r = await db.pool.query(toPgPlaceholders(sql), params);
    return r.rows;
  }
  return db.prepare(sql).all(...params);
}

/** Devuelve la primera fila o undefined. */
async function queryOne(db, sql, params = []) {
  if (isPg(db)) {
    const r = await db.pool.query(toPgPlaceholders(sql), params);
    return r.rows[0];
  }
  return db.prepare(sql).get(...params);
}

/** Ejecuta INSERT/UPDATE/DELETE. Devuelve { id, changes }. */
async function run(db, sql, params = []) {
  if (isPg(db)) {
    let q = toPgPlaceholders(sql);
    if (/^\s*insert\b/i.test(sql) && !/returning\b/i.test(sql)) q += ' RETURNING id';
    const r = await db.pool.query(q, params);
    const id = r.rows && r.rows[0] ? Number(r.rows[0].id) : 0;
    return { id, changes: r.rowCount };
  }
  const info = db.prepare(sql).run(...params);
  return { id: Number(info.lastInsertRowid), changes: Number(info.changes) };
}

/** true si el error es violación de constraint UNIQUE (sqlite: 19, pg: 23505). */
function isUniqueViolation(err) {
  return Boolean(err && (
    err.code === 'SQLITE_CONSTRAINT_UNIQUE'
    || err.code === '23505'
    || /UNIQUE constraint/i.test(err.message || '')
    || /duplicate key/i.test(err.message || '')
  ));
}

/** Cierra la base (necesario para Postgres: termina el pool). */
async function closeDb(db) {
  if (!db) return;
  if (isPg(db)) { await db.pool.end(); return; }
  db.close();
}

module.exports = { openDb, migrate, queryAll, queryOne, run, isUniqueViolation, closeDb, isPg };
