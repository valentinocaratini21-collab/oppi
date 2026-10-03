-- Schema de Oppi (SQLite). Idempotente: CREATE TABLE IF NOT EXISTS.
-- Las columnas JSON se guardan como TEXT (JSON.stringify / JSON.parse en la app).

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT UNIQUE,                      -- NULL = cuenta eliminada (anonimizada)
  phone         TEXT,
  barrio        TEXT DEFAULT '',
  foto_url      TEXT DEFAULT '',
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'client' CHECK (role IN ('client','pro','handyman','business')),
  referral_code TEXT NOT NULL UNIQUE,
  credit_gs     INTEGER NOT NULL DEFAULT 0,
  suspended     INTEGER NOT NULL DEFAULT 0,      -- 1 = no puede crear reservas (3 no-shows o suspensión admin)
  no_show_count INTEGER NOT NULL DEFAULT 0,      -- no-shows del cliente
  featured_until TEXT,                            -- destacado hasta (compensa no-show del pro)
  is_admin      INTEGER NOT NULL DEFAULT 0,      -- 1 = administrador de la plataforma (panel /api/admin)
  terms_accepted_at TEXT,                         -- cuándo aceptó los TyC (NULL = cuenta anterior al requisito)
  deleted_at    TEXT,                             -- cuenta eliminada (anonimizada); NULL = activa
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS professionals (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  bio        TEXT DEFAULT '',
  categories TEXT NOT NULL DEFAULT '[]',          -- JSON array
  profession_id INTEGER REFERENCES professions(id), -- taxonomía (mejora 7, nullable)
  rating     REAL NOT NULL DEFAULT 0,
  verified   INTEGER NOT NULL DEFAULT 0,          -- boolean 0/1
  barrio     TEXT DEFAULT '',
  lat        REAL,                                -- geolocalización (Asunción)
  lng        REAL,
  no_show_count INTEGER NOT NULL DEFAULT 0,     -- faltas del profesional marcadas por clientes
  suspended   INTEGER NOT NULL DEFAULT 0,         -- 1 = no recibe reservas nuevas
  featured_until TEXT,                            -- destacado hasta (compensa no-show propio)
  verification_note TEXT                          -- motivo del último rechazo de verificación (panel admin)
);

CREATE TABLE IF NOT EXISTS services (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  professional_id INTEGER REFERENCES professionals(id) ON DELETE CASCADE,
  business_id     INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  price_gs        INTEGER NOT NULL CHECK (price_gs > 0),
  deposit_type    TEXT NOT NULL DEFAULT 'none' CHECK (deposit_type IN ('percent','fixed','none')),
  deposit_value   REAL NOT NULL DEFAULT 0,
  photo_url       TEXT,                            -- detalle del servicio (mejora 2)
  description     TEXT DEFAULT '',
  includes        TEXT NOT NULL DEFAULT '[]',     -- JSON array de strings ("qué incluye")
  CHECK (professional_id IS NOT NULL OR business_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS slots (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  professional_id INTEGER NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  date            TEXT NOT NULL,                   -- AAAA-MM-DD
  time            TEXT NOT NULL,                   -- HH:MM
  status          TEXT NOT NULL DEFAULT 'free' CHECK (status IN ('free','booked')),
  UNIQUE (professional_id, date, time)
);

CREATE TABLE IF NOT EXISTS coupons (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,                        -- siempre en mayúsculas
  type        TEXT NOT NULL CHECK (type IN ('percent','fixed')),
  value       INTEGER NOT NULL CHECK (value > 0),
  max_uses    INTEGER,                              -- NULL = ilimitado
  used_count  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,           -- boolean 0/1
  valid_from  TEXT,                                 -- AAAA-MM-DD [HH:MM[:SS]]
  valid_until TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (business_id, code)
);
CREATE INDEX IF NOT EXISTS idx_coupons_business ON coupons(business_id);

CREATE TABLE IF NOT EXISTS bookings (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id        INTEGER NOT NULL REFERENCES users(id),
  service_id       INTEGER NOT NULL REFERENCES services(id),
  slot_id          INTEGER REFERENCES slots(id),
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','confirmed','completed','cancelled','no_show_client','no_show_pro')),
  deposit_gs       INTEGER NOT NULL DEFAULT 0, -- (deprecado: seña eliminada 2026-10; ver paid_gs)
  deposit_paid     INTEGER NOT NULL DEFAULT 0,     -- boolean 0/1 (seña retenida)
  paid_gs          INTEGER NOT NULL DEFAULT 0,     -- monto cobrado al cliente (100% del total)
  paid             INTEGER NOT NULL DEFAULT 0,     -- boolean 0/1 (el cobro está acreditado)
  total_gs         INTEGER NOT NULL,
  credit_applied_gs INTEGER NOT NULL DEFAULT 0,
  coupon_id        INTEGER REFERENCES coupons(id),
  discount_gs      INTEGER NOT NULL DEFAULT 0,
  branch_id        INTEGER REFERENCES branches(id), -- sucursal (mejora 1, opcional)
  en_route_at      TEXT,                            -- el pro/negocio avisó que va en camino
  confirmed_at     TEXT,                            -- cuándo se confirmó (para free_until)
  free_until       TEXT,                            -- hasta cuándo se puede cancelar gratis ('AAAA-MM-DD HH:MM:SS')
  cancel_reason    TEXT,                            -- código de motivo (ver CANCEL_REASONS)
  cancel_detail    TEXT,                            -- detalle libre / sucursal / colaborador
  cancelled_by     TEXT CHECK (cancelled_by IN ('client','pro','business')),
  cancelled_at     TEXT,                            -- cuándo se canceló / marcó no-show
  wildcard_used    INTEGER NOT NULL DEFAULT 0,     -- se consumió 1 comodín en la cancelación
  free_cancel      INTEGER NOT NULL DEFAULT 0,     -- la cancelación fue dentro del plazo gratis
  no_show_kind     TEXT CHECK (no_show_kind IN ('client','pro')),
  reschedule_count INTEGER NOT NULL DEFAULT 0,     -- veces que se reprogramó
  rescheduled_at   TEXT,                            -- última reprogramación
  points_gs        INTEGER NOT NULL DEFAULT 0,     -- Oppi Points aplicados como descuento
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS favorites (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  professional_id INTEGER NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  UNIQUE (client_id, professional_id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  participants TEXT NOT NULL DEFAULT '[]',        -- JSON array de user ids
  task_id      INTEGER REFERENCES tasks(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       INTEGER NOT NULL REFERENCES users(id),
  text            TEXT NOT NULL DEFAULT '',
  photos          TEXT NOT NULL DEFAULT '[]',     -- JSON [{filename, url}]
  quote           TEXT,                            -- JSON {amount_gs, detail, status} | NULL
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id     INTEGER NOT NULL REFERENCES users(id),
  title         TEXT NOT NULL,
  description   TEXT DEFAULT '',
  category      TEXT DEFAULT '',
  barrio        TEXT DEFAULT '',
  lat           REAL,                                -- geolocalización de la chamba
  lng           REAL,
  price_min_gs  INTEGER,
  price_max_gs  INTEGER,
  urgent        INTEGER NOT NULL DEFAULT 0,        -- boolean 0/1 ("lo necesito hoy")
  photos        TEXT NOT NULL DEFAULT '[]',        -- JSON
  status        TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','assigned','done','cancelled')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS offers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  handyman_id INTEGER NOT NULL REFERENCES users(id),
  amount_gs  INTEGER NOT NULL CHECK (amount_gs > 0),
  message    TEXT DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'pending'
             CHECK (status IN ('pending','accepted','rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS jobs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id         INTEGER NOT NULL REFERENCES tasks(id),
  offer_id        INTEGER NOT NULL REFERENCES offers(id),
  client_id       INTEGER NOT NULL REFERENCES users(id),
  handyman_id     INTEGER NOT NULL REFERENCES users(id),
  agreed_price_gs INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'quoting'
                  CHECK (status IN ('quoting','in_progress','completed')),
  deposit_held_gs INTEGER NOT NULL DEFAULT 0,     -- (deprecado: seña eliminada 2026-10; ver paid_gs)
  paid_gs         INTEGER NOT NULL DEFAULT 0,     -- monto cobrado al cliente (100% del precio acordado)
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reviews (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER REFERENCES bookings(id),
  job_id     INTEGER REFERENCES jobs(id),
  from_user  INTEGER NOT NULL REFERENCES users(id),
  to_user    INTEGER NOT NULL REFERENCES users(id),
  rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  text       TEXT DEFAULT '',
  photos     TEXT NOT NULL DEFAULT '[]',            -- JSON array de URLs de /api/uploads (máx 3)
  reply_text TEXT,                                  -- respuesta del pro/negocio (una sola vez)
  reply_at   TEXT,
  moderation_status TEXT NOT NULL DEFAULT 'approved' -- equipo IA: moderador ('approved'|'held'|'rejected')
              CHECK (moderation_status IN ('approved','held','rejected')),
  moderation_reason TEXT,                           -- motivo cuando queda retenida/rechazada
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (booking_id IS NOT NULL OR job_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS businesses (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  ruc               TEXT DEFAULT '',
  logo_url          TEXT DEFAULT '',              -- logo/foto del negocio (equipo IA: guardián)
  description       TEXT DEFAULT '',              -- descripción del negocio (equipo IA: guardián)
  categories        TEXT NOT NULL DEFAULT '[]',    -- JSON array
  category_id       INTEGER REFERENCES categories(id), -- taxonomía (mejora 7, nullable)
  verification_status TEXT NOT NULL DEFAULT 'pending'
                    CHECK (verification_status IN ('pending','verified')),
  barrio            TEXT DEFAULT '',
  address           TEXT DEFAULT '',
  lat               REAL,                          -- geolocalización (Asunción)
  lng               REAL,
  schedule          TEXT NOT NULL DEFAULT '[]',    -- JSON [{day, open, close}]
  cancel_free_hours INTEGER NOT NULL DEFAULT 24,   -- h antes del turno con cancelación sin cargo
  min_advance_hours INTEGER,                        -- NULL = sin mínimo de anticipación para reservar
  suspended       INTEGER NOT NULL DEFAULT 0,     -- 1 = no recibe reservas nuevas
  no_show_count   INTEGER NOT NULL DEFAULT 0,     -- no-shows del negocio marcados por clientes
  verification_note TEXT                          -- motivo del último rechazo de verificación (panel admin)
);

CREATE TABLE IF NOT EXISTS business_documents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,                        -- ruc | habilitacion | identidad | ...
  file_url    TEXT,                                 -- archivo subido (/api/uploads) — equipo IA: verificador
  file_size   INTEGER,                              -- tamaño en bytes (para chequeo de legibilidad)
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','approved','rejected')),
  UNIQUE (business_id, type)
);

CREATE TABLE IF NOT EXISTS team_members (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL, -- cuenta vinculada (NULL = solo ficha sin acceso)
  name        TEXT NOT NULL,
  role        TEXT DEFAULT '',                       -- cargo / función (texto libre, ej. "Estilista")
  permiso     TEXT NOT NULL DEFAULT 'lectura'
              CHECK (permiso IN ('admin','editor','lectura')), -- rol de acceso al panel del negocio
  services    TEXT NOT NULL DEFAULT '[]'            -- JSON array de service ids/nombres
);

-- Preferencias de notificaciones por usuario (pieza "lista para lanzar" 5).
-- Sin fila → todo activado (defaults true).
CREATE TABLE IF NOT EXISTS notification_prefs (
  user_id   INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  reminders INTEGER NOT NULL DEFAULT 1,   -- recordatorios de turnos, lista de espera, pedido de reseña
  offers    INTEGER NOT NULL DEFAULT 1,   -- ofertas y presupuestos del marketplace
  messages  INTEGER NOT NULL DEFAULT 1,   -- reservas, trabajos, reseñas, soporte
  promos     INTEGER NOT NULL DEFAULT 1    -- referidos y promociones
);

-- Taxonomía de rubros (mejora 7). Se siembra en la migración (ver src/db/taxonomy.js).
CREATE TABLE IF NOT EXISTS categories (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  icono  TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS professions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  UNIQUE (category_id, nombre)
);

CREATE TABLE IF NOT EXISTS subcategories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  UNIQUE (category_id, nombre)
);

-- Sucursales de un negocio (mejora 1).
CREATE TABLE IF NOT EXISTS branches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  direccion   TEXT DEFAULT '',
  lat         REAL,
  lng         REAL,
  telefono    TEXT DEFAULT '',
  horario     TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_branches_business ON branches(business_id);

CREATE TABLE IF NOT EXISTS waitlist (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  professional_id INTEGER NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  service_id      INTEGER REFERENCES services(id),
  slot_desc       TEXT NOT NULL,                     -- ej. "sábado a la mañana"
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (client_id, professional_id, slot_desc)
);

CREATE TABLE IF NOT EXISTS referrals (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL UNIQUE,
  owner_user_id INTEGER NOT NULL REFERENCES users(id),
  max_uses      INTEGER NOT NULL DEFAULT 50,
  uses          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS referral_redemptions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT NOT NULL,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (code, user_id)
);

-- Tipos de notificación:
--   reminder      → recordatorios de turnos ("tu turno es mañana")
--   review_request→ (reservado) pedido de reseña
--   waitlist      → se liberó un lugar en la lista de espera
--   booking       → reserva creada / confirmada / cancelada
--   referral      → alguien usó tu código de referido
--   offer         → oferta recibida / aceptada / rechazada (marketplace)
--   quote         → cotización recibida / aceptada / rechazada (chat)
--   job           → trabajo completado
--   review        → reseña recibida / respondida
CREATE TABLE IF NOT EXISTS notifications (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN ('reminder','review_request','waitlist','booking','referral','offer','quote','job','review','support')),
  title        TEXT NOT NULL,
  body         TEXT DEFAULT '',
  read         INTEGER NOT NULL DEFAULT 0,          -- boolean 0/1
  scheduled_for TEXT,                                -- ISO datetime opcional
  push_sent    INTEGER NOT NULL DEFAULT 0,          -- boolean 0/1: ya se envió por FCM/APNs
  push_sent_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_services_pro ON services(professional_id);
CREATE INDEX IF NOT EXISTS idx_services_biz ON services(business_id);
CREATE INDEX IF NOT EXISTS idx_slots_pro ON slots(professional_id, date);
CREATE INDEX IF NOT EXISTS idx_bookings_client ON bookings(client_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, urgent);
CREATE INDEX IF NOT EXISTS idx_offers_task ON offers(task_id);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read);

-- Pagos: registro de cada movimiento contra la pasarela (cobros del 100%
-- del total y reembolsos). Lo escribe src/lib/payments.js cada vez que el
-- provider (mock o real) ejecuta una operación.
CREATE TABLE IF NOT EXISTS payments (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  reference_type      TEXT NOT NULL,              -- 'booking' | 'job'
  reference_id        INTEGER NOT NULL,
  provider            TEXT NOT NULL DEFAULT 'mock', -- driver que la procesó
  provider_payment_id TEXT,                         -- id en la pasarela (mock_... en mock)
  kind                TEXT NOT NULL DEFAULT 'charge'
                      CHECK (kind IN ('charge','refund')),
  amount_gs           INTEGER NOT NULL CHECK (amount_gs >= 0),
  status              TEXT NOT NULL DEFAULT 'captured'
                      CHECK (status IN ('pending','held','captured','released','refunded','failed')),
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_payments_ref ON payments(reference_type, reference_id);

-- Tokens de push por dispositivo (para FCM/APNs cuando PUSH_DRIVER != mock).
CREATE TABLE IF NOT EXISTS push_tokens (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL,
  platform   TEXT NOT NULL DEFAULT 'android' CHECK (platform IN ('android','ios','web')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, token)
);

-- Comodines de cancelación (nueva política): únicos por dueño y trimestre.
-- owner_type 'user' → owner_id = users.id (cliente o profesional);
-- owner_type 'business' → owner_id = businesses.id.
-- Cada trimestre el balance vuelve a 3 (reseteo lazy al leer/usar).
CREATE TABLE IF NOT EXISTS wildcards (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_type          TEXT NOT NULL CHECK (owner_type IN ('user','business')),
  owner_id            INTEGER NOT NULL,
  balance             INTEGER NOT NULL DEFAULT 3,
  trimester           TEXT NOT NULL,                    -- 'YYYY-Qn'
  completed_since_last INTEGER NOT NULL DEFAULT 0,      -- completadas desde el último comodín ganado
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (owner_type, owner_id, trimester)
);
CREATE INDEX IF NOT EXISTS idx_wildcards_owner ON wildcards(owner_type, owner_id);

-- Oppi Points: ledger de puntos ganados (ej. compensación por no-show del
-- prestador). Se canjean como descuento automático en la próxima reserva
-- (ver bookings.points_gs). amount_gs siempre > 0 (solo créditos).
CREATE TABLE IF NOT EXISTS points_ledger (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_gs  INTEGER NOT NULL CHECK (amount_gs > 0),
  reason     TEXT NOT NULL,                          -- ej. 'no_show_pro', 'no_show_client'
  ref_type   TEXT,                                   -- ej. 'booking'
  ref_id     INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_points_user ON points_ledger(user_id);

-- Soporte por WhatsApp (bandeja + bot).
CREATE TABLE IF NOT EXISTS support_conversations (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id       TEXT NOT NULL UNIQUE,      -- wa_id del contacto (o 'mock-...' en pruebas)
  user_id           INTEGER REFERENCES users(id),
  business_id       INTEGER REFERENCES businesses(id),
  kind              TEXT NOT NULL DEFAULT 'client' CHECK (kind IN ('client','business')),
  status            TEXT NOT NULL DEFAULT 'bot' CHECK (status IN ('bot','human','resolved')),
  assigned_agent_id INTEGER REFERENCES support_agents(id),
  channel           TEXT NOT NULL DEFAULT 'whatsapp',
  bot_state         TEXT,                      -- paso actual del bot (ej. 'await_noshow_number')
  bot_misses        INTEGER NOT NULL DEFAULT 0,-- "no te entendí" seguidos (2 -> handoff)
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_support_conv_status ON support_conversations(status, updated_at);

CREATE TABLE IF NOT EXISTS support_messages (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
  direction      TEXT NOT NULL CHECK (direction IN ('in','out')),
  sender         TEXT NOT NULL CHECK (sender IN ('bot','human','user')),
  body           TEXT NOT NULL DEFAULT '',
  wa_message_id  TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_support_msg_conv ON support_messages(conversation_id, id);

-- Agentes humanos que atienden la bandeja de soporte.
CREATE TABLE IF NOT EXISTS support_agents (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('admin','agent')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Visitas a perfiles (estadísticas MVP por rol, 2026-10): 1 visita por día
-- por visitante por perfil. visitor_key = 'user:<id>' (con sesión) o 'ip:<ip>'.
CREATE TABLE IF NOT EXISTS profile_views (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_type TEXT NOT NULL CHECK (profile_type IN ('professional','business')),
  profile_id   INTEGER NOT NULL,
  visitor_key  TEXT NOT NULL,
  viewed_at    TEXT NOT NULL DEFAULT (datetime('now')),
  day          TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_views_dedup
  ON profile_views(profile_type, profile_id, visitor_key, day);
CREATE INDEX IF NOT EXISTS idx_profile_views_profile
  ON profile_views(profile_type, profile_id, viewed_at);

-- Equipo IA de Oppi (2026-10): prospectos del reclutador, borradores de
-- contenido y registro de corridas de agentes (anti-spam / idempotencia).
CREATE TABLE IF NOT EXISTS prospects (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,                          -- nombre o @handle del profesional
  source     TEXT NOT NULL DEFAULT 'manual'          -- instagram | google | referido | manual
              CHECK (source IN ('instagram','google','referido','manual')),
  category   TEXT DEFAULT '',                        -- rubro (taxonomía)
  barrio     TEXT DEFAULT '',                        -- barrio de Asunción
  contact    TEXT DEFAULT '',                        -- dato de contacto si se conoce
  status     TEXT NOT NULL DEFAULT 'nuevo'
              CHECK (status IN ('nuevo','contactado','respondio','registrado','descartado')),
  notes      TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_prospects_status ON prospects(status, updated_at);

CREATE TABLE IF NOT EXISTS content_drafts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL                         -- beneficio | como_funciona | prueba_social | countdown
              CHECK (kind IN ('beneficio','como_funciona','prueba_social','countdown')),
  title        TEXT NOT NULL,
  caption      TEXT NOT NULL DEFAULT '',             -- texto del posteo (voseo rioplatense)
  hashtags     TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'draft'         -- draft | approved | published | discarded
              CHECK (status IN ('draft','approved','published','discarded')),
  scheduled_for TEXT,                                -- fecha objetivo de publicación (opcional)
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at  TEXT,
  approved_by  INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_content_drafts_status ON content_drafts(status, scheduled_for);

-- Registro de corridas de los agentes (guardián, centinela, etc.): sirve
-- para no spamear (máx 1 nudge por semana por usuario) y para auditar.
CREATE TABLE IF NOT EXISTS agent_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  agent       TEXT NOT NULL,                          -- guardian | sentinel | verifier | ...
  action      TEXT NOT NULL,                          -- ej. 'nudge_profile' | 'alert_no_response'
  target_type TEXT,                                   -- 'user' | 'business' | 'booking' | ...
  target_id   INTEGER,
  detail      TEXT DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent ON agent_runs(agent, target_type, target_id, created_at);
