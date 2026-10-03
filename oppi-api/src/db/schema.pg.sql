-- Schema de Oppi para POSTGRES. Idempotente: CREATE TABLE IF NOT EXISTS.
-- Lo aplica src/db/index.js (migrate) cuando existe DATABASE_URL.
--
-- Decisiones de compatibilidad con el driver SQLite (para que las rutas usen
-- el MISMO SQL en ambos):
--  - Columnas JSON (categories, photos, participants, etc.): TEXT, no JSONB.
--    La app hace JSON.stringify/parse igual que en SQLite. Pasar a JSONB es
--    una mejora futura (requeriría parseo condicional en los DTOs).
--  - Booleanos: INTEGER 0/1, no BOOLEAN (el SQL usa `= 0`, `= 1`).
--  - created_at: TEXT 'AAAA-MM-DD HH:MM:SS' vía to_char(now(), ...),
--    igual formato que datetime('now') de SQLite (las comparaciones de
--    strings y los ORDER BY se comportan igual).
--  - IDs: INTEGER GENERATED ALWAYS AS IDENTITY (los INSERT no pasan id y
--    el helper agrega `RETURNING id` automáticamente).

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
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
  created_at    TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
);

-- Taxonomía de rubros (mejora 7). Se siembra en la migración (ver src/db/taxonomy.js).
-- Va antes de professionals/businesses porque esas tablas la referencian.
CREATE TABLE IF NOT EXISTS categories (
  id     INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  icono  TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS professions (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  UNIQUE (category_id, nombre)
);

CREATE TABLE IF NOT EXISTS subcategories (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  UNIQUE (category_id, nombre)
);

CREATE TABLE IF NOT EXISTS professionals (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  bio        TEXT DEFAULT '',
  categories TEXT NOT NULL DEFAULT '[]',
  profession_id INTEGER REFERENCES professions(id), -- taxonomía (mejora 7, nullable)
  rating     DOUBLE PRECISION NOT NULL DEFAULT 0,
  verified   INTEGER NOT NULL DEFAULT 0,
  barrio     TEXT DEFAULT '',
  lat        REAL,
  lng        REAL,
  no_show_count INTEGER NOT NULL DEFAULT 0,     -- faltas del profesional marcadas por clientes
  suspended   INTEGER NOT NULL DEFAULT 0,
  featured_until TEXT,
  verification_note TEXT
);

CREATE TABLE IF NOT EXISTS businesses (
  id                INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id           INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  ruc               TEXT DEFAULT '',
  logo_url          TEXT DEFAULT '',              -- logo/foto del negocio (equipo IA: guardián)
  description       TEXT DEFAULT '',              -- descripción del negocio (equipo IA: guardián)
  categories        TEXT NOT NULL DEFAULT '[]',
  category_id       INTEGER REFERENCES categories(id), -- taxonomía (mejora 7, nullable)
  verification_status TEXT NOT NULL DEFAULT 'pending'
                    CHECK (verification_status IN ('pending','verified')),
  barrio            TEXT DEFAULT '',
  address           TEXT DEFAULT '',
  lat               REAL,
  lng               REAL,
  schedule          TEXT NOT NULL DEFAULT '[]',
  cancel_free_hours INTEGER NOT NULL DEFAULT 24,   -- h antes del turno con cancelación sin cargo
  min_advance_hours INTEGER,                       -- NULL = sin mínimo de anticipación para reservar
  suspended       INTEGER NOT NULL DEFAULT 0,
  no_show_count   INTEGER NOT NULL DEFAULT 0,
  verification_note TEXT
);

CREATE TABLE IF NOT EXISTS business_documents (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  file_url    TEXT,                                 -- archivo subido (/api/uploads) — equipo IA: verificador
  file_size   INTEGER,                              -- tamaño en bytes (para chequeo de legibilidad)
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','approved','rejected')),
  UNIQUE (business_id, type)
);

CREATE TABLE IF NOT EXISTS team_members (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  role        TEXT DEFAULT '',
  permiso     TEXT NOT NULL DEFAULT 'lectura'
              CHECK (permiso IN ('admin','editor','lectura')),
  services    TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS notification_prefs (
  user_id   INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  reminders INTEGER NOT NULL DEFAULT 1,
  offers    INTEGER NOT NULL DEFAULT 1,
  messages  INTEGER NOT NULL DEFAULT 1,
  promos     INTEGER NOT NULL DEFAULT 1
);

-- Sucursales de un negocio (mejora 1). Va antes de bookings (la referencia).
CREATE TABLE IF NOT EXISTS branches (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  direccion   TEXT DEFAULT '',
  lat         REAL,
  lng         REAL,
  telefono    TEXT DEFAULT '',
  horario     TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_branches_business ON branches(business_id);

CREATE TABLE IF NOT EXISTS services (
  id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  professional_id INTEGER REFERENCES professionals(id) ON DELETE CASCADE,
  business_id     INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  price_gs        INTEGER NOT NULL CHECK (price_gs > 0),
  deposit_type    TEXT NOT NULL DEFAULT 'none' CHECK (deposit_type IN ('percent','fixed','none')),
  deposit_value   DOUBLE PRECISION NOT NULL DEFAULT 0,
  photo_url       TEXT,                            -- detalle del servicio (mejora 2)
  description     TEXT DEFAULT '',
  includes        TEXT NOT NULL DEFAULT '[]',     -- JSON array de strings ("qué incluye")
  CHECK (professional_id IS NOT NULL OR business_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS slots (
  id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  professional_id INTEGER NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  date            TEXT NOT NULL,
  time            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'free' CHECK (status IN ('free','booked')),
  UNIQUE (professional_id, date, time)
);

CREATE TABLE IF NOT EXISTS coupons (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('percent','fixed')),
  value       INTEGER NOT NULL CHECK (value > 0),
  max_uses    INTEGER,
  used_count  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  valid_from  TEXT,
  valid_until TEXT,
  created_at  TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS')),
  UNIQUE (business_id, code)
);
CREATE INDEX IF NOT EXISTS idx_coupons_business ON coupons(business_id);

CREATE TABLE IF NOT EXISTS bookings (
  id               INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id        INTEGER NOT NULL REFERENCES users(id),
  service_id       INTEGER NOT NULL REFERENCES services(id),
  slot_id          INTEGER REFERENCES slots(id),
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','confirmed','completed','cancelled','no_show_client','no_show_pro')),
  deposit_gs       INTEGER NOT NULL DEFAULT 0, -- (deprecado: seña eliminada 2026-10; ver paid_gs)
  deposit_paid     INTEGER NOT NULL DEFAULT 0, -- (deprecado: ver paid)
  paid_gs          INTEGER NOT NULL DEFAULT 0, -- monto cobrado al cliente (100% del total)
  paid             INTEGER NOT NULL DEFAULT 0, -- boolean 0/1 (el cobro está acreditado)
  total_gs         INTEGER NOT NULL,
  credit_applied_gs INTEGER NOT NULL DEFAULT 0,
  coupon_id        INTEGER REFERENCES coupons(id),
  discount_gs      INTEGER NOT NULL DEFAULT 0,
  branch_id        INTEGER REFERENCES branches(id), -- sucursal (mejora 1, opcional)
  en_route_at      TEXT,                            -- el pro/negocio avisó que va en camino
  confirmed_at     TEXT,
  free_until       TEXT,                            -- hasta cuándo se puede cancelar gratis
  cancel_reason    TEXT,
  cancel_detail    TEXT,
  cancelled_by     TEXT CHECK (cancelled_by IN ('client','pro','business')),
  cancelled_at     TEXT,
  wildcard_used    INTEGER NOT NULL DEFAULT 0,
  free_cancel      INTEGER NOT NULL DEFAULT 0,
  no_show_kind     TEXT CHECK (no_show_kind IN ('client','pro')),
  reschedule_count INTEGER NOT NULL DEFAULT 0,
  rescheduled_at   TEXT,
  points_gs        INTEGER NOT NULL DEFAULT 0,     -- Oppi Points aplicados como descuento
  created_at       TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS favorites (
  id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  professional_id INTEGER NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  UNIQUE (client_id, professional_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id     INTEGER NOT NULL REFERENCES users(id),
  title         TEXT NOT NULL,
  description   TEXT DEFAULT '',
  category      TEXT DEFAULT '',
  barrio        TEXT DEFAULT '',
  lat           REAL,                                -- geolocalización de la chamba
  lng           REAL,
  price_min_gs  INTEGER,
  price_max_gs  INTEGER,
  urgent        INTEGER NOT NULL DEFAULT 0,
  photos        TEXT NOT NULL DEFAULT '[]',
  status        TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','assigned','done','cancelled')),
  created_at    TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS conversations (
  id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  participants TEXT NOT NULL DEFAULT '[]',
  task_id      INTEGER REFERENCES tasks(id),
  created_at   TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       INTEGER NOT NULL REFERENCES users(id),
  text            TEXT NOT NULL DEFAULT '',
  photos          TEXT NOT NULL DEFAULT '[]',
  quote           TEXT,
  created_at      TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS offers (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  handyman_id INTEGER NOT NULL REFERENCES users(id),
  amount_gs  INTEGER NOT NULL CHECK (amount_gs > 0),
  message    TEXT DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'pending'
             CHECK (status IN ('pending','accepted','rejected')),
  created_at TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS jobs (
  id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id         INTEGER NOT NULL REFERENCES tasks(id),
  offer_id        INTEGER NOT NULL REFERENCES offers(id),
  client_id       INTEGER NOT NULL REFERENCES users(id),
  handyman_id     INTEGER NOT NULL REFERENCES users(id),
  agreed_price_gs INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'quoting'
                  CHECK (status IN ('quoting','in_progress','completed')),
  deposit_held_gs INTEGER NOT NULL DEFAULT 0, -- (deprecado: seña eliminada 2026-10; ver paid_gs)
  paid_gs         INTEGER NOT NULL DEFAULT 0, -- monto cobrado al cliente (100% del precio acordado)
  created_at      TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS reviews (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  booking_id INTEGER REFERENCES bookings(id),
  job_id     INTEGER REFERENCES jobs(id),
  from_user  INTEGER NOT NULL REFERENCES users(id),
  to_user    INTEGER NOT NULL REFERENCES users(id),
  rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  text       TEXT DEFAULT '',
  photos     TEXT NOT NULL DEFAULT '[]',            -- JSON array de URLs de /api/uploads (máx 3)
  reply_text TEXT,
  reply_at   TEXT,
  moderation_status TEXT NOT NULL DEFAULT 'approved' -- equipo IA: moderador ('approved'|'held'|'rejected')
              CHECK (moderation_status IN ('approved','held','rejected')),
  moderation_reason TEXT,                           -- motivo cuando queda retenida/rechazada
  created_at TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS')),
  CHECK (booking_id IS NOT NULL OR job_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS waitlist (
  id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  professional_id INTEGER NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  service_id      INTEGER REFERENCES services(id),
  slot_desc       TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS')),
  UNIQUE (client_id, professional_id, slot_desc)
);

CREATE TABLE IF NOT EXISTS referrals (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  owner_user_id INTEGER NOT NULL REFERENCES users(id),
  max_uses      INTEGER NOT NULL DEFAULT 50,
  uses          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS referral_redemptions (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code       TEXT NOT NULL,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS')),
  UNIQUE (code, user_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN ('reminder','review_request','waitlist','booking','referral','offer','quote','job','review','support')),
  title        TEXT NOT NULL,
  body         TEXT DEFAULT '',
  read         INTEGER NOT NULL DEFAULT 0,
  scheduled_for TEXT,
  push_sent    INTEGER NOT NULL DEFAULT 0,
  push_sent_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS payments (
  id                  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reference_type      TEXT NOT NULL,
  reference_id        INTEGER NOT NULL,
  provider            TEXT NOT NULL DEFAULT 'mock',
  provider_payment_id TEXT,
  kind                TEXT NOT NULL DEFAULT 'charge'
                      CHECK (kind IN ('charge','refund')),
  amount_gs           INTEGER NOT NULL CHECK (amount_gs >= 0),
  status              TEXT NOT NULL DEFAULT 'captured'
                      CHECK (status IN ('pending','held','captured','released','refunded','failed')),
  created_at          TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS push_tokens (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL,
  platform   TEXT NOT NULL DEFAULT 'android' CHECK (platform IN ('android','ios','web')),
  created_at TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS')),
  UNIQUE (user_id, token)
);

CREATE TABLE IF NOT EXISTS wildcards (
  id                  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_type          TEXT NOT NULL CHECK (owner_type IN ('user','business')),
  owner_id            INTEGER NOT NULL,
  balance             INTEGER NOT NULL DEFAULT 3,
  trimester           TEXT NOT NULL,
  completed_since_last INTEGER NOT NULL DEFAULT 0,
  updated_at          TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS')),
  UNIQUE (owner_type, owner_id, trimester)
);
CREATE INDEX IF NOT EXISTS idx_wildcards_owner ON wildcards(owner_type, owner_id);

CREATE TABLE IF NOT EXISTS points_ledger (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_gs  INTEGER NOT NULL CHECK (amount_gs > 0),
  reason     TEXT NOT NULL,
  ref_type   TEXT,
  ref_id     INTEGER,
  created_at TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS idx_points_user ON points_ledger(user_id);

CREATE INDEX IF NOT EXISTS idx_services_pro ON services(professional_id);
CREATE INDEX IF NOT EXISTS idx_services_biz ON services(business_id);
CREATE INDEX IF NOT EXISTS idx_slots_pro ON slots(professional_id, date);
CREATE INDEX IF NOT EXISTS idx_bookings_client ON bookings(client_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, urgent);
CREATE INDEX IF NOT EXISTS idx_offers_task ON offers(task_id);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read);
CREATE INDEX IF NOT EXISTS idx_payments_ref ON payments(reference_type, reference_id);

-- Soporte por WhatsApp (bandeja + bot).
CREATE TABLE IF NOT EXISTS support_conversations (
  id                INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  external_id       TEXT NOT NULL UNIQUE,
  user_id           INTEGER REFERENCES users(id),
  business_id       INTEGER REFERENCES businesses(id),
  kind              TEXT NOT NULL DEFAULT 'client' CHECK (kind IN ('client','business')),
  status            TEXT NOT NULL DEFAULT 'bot' CHECK (status IN ('bot','human','resolved')),
  assigned_agent_id INTEGER REFERENCES support_agents(id),
  channel           TEXT NOT NULL DEFAULT 'whatsapp',
  bot_state         TEXT,
  bot_misses        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS')),
  updated_at        TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS idx_support_conv_status ON support_conversations(status, updated_at);

CREATE TABLE IF NOT EXISTS support_messages (
  id             INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
  direction      TEXT NOT NULL CHECK (direction IN ('in','out')),
  sender         TEXT NOT NULL CHECK (sender IN ('bot','human','user')),
  body           TEXT NOT NULL DEFAULT '',
  wa_message_id  TEXT,
  created_at     TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS idx_support_msg_conv ON support_messages(conversation_id, id);

CREATE TABLE IF NOT EXISTS support_agents (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('admin','agent')),
  created_at TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
);

-- Visitas a perfiles (estadísticas MVP por rol, 2026-10): 1 visita por día
-- por visitante por perfil. visitor_key = 'user:<id>' (con sesión) o 'ip:<ip>'.
CREATE TABLE IF NOT EXISTS profile_views (
  id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  profile_type TEXT NOT NULL CHECK (profile_type IN ('professional','business')),
  profile_id   INTEGER NOT NULL,
  visitor_key  TEXT NOT NULL,
  viewed_at    TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS')),
  day          TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_views_dedup
  ON profile_views(profile_type, profile_id, visitor_key, day);
CREATE INDEX IF NOT EXISTS idx_profile_views_profile
  ON profile_views(profile_type, profile_id, viewed_at);

-- Equipo IA de Oppi (2026-10): prospectos del reclutador, borradores de
-- contenido y registro de corridas de agentes (anti-spam / idempotencia).
CREATE TABLE IF NOT EXISTS prospects (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       TEXT NOT NULL,
  source     TEXT NOT NULL DEFAULT 'manual'
              CHECK (source IN ('instagram','google','referido','manual')),
  category   TEXT DEFAULT '',
  barrio     TEXT DEFAULT '',
  contact    TEXT DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'nuevo'
              CHECK (status IN ('nuevo','contactado','respondio','registrado','descartado')),
  notes      TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS')),
  updated_at TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS idx_prospects_status ON prospects(status, updated_at);

CREATE TABLE IF NOT EXISTS content_drafts (
  id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind         TEXT NOT NULL
              CHECK (kind IN ('beneficio','como_funciona','prueba_social','countdown')),
  title        TEXT NOT NULL,
  caption      TEXT NOT NULL DEFAULT '',
  hashtags     TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft','approved','published','discarded')),
  scheduled_for TEXT,
  created_at   TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS')),
  approved_at  TEXT,
  approved_by  INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_content_drafts_status ON content_drafts(status, scheduled_for);

CREATE TABLE IF NOT EXISTS agent_runs (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agent       TEXT NOT NULL,
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   INTEGER,
  detail      TEXT DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent ON agent_runs(agent, target_type, target_id, created_at);
