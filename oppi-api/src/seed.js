'use strict';

/**
 * Seed de Oppi: datos paraguayos coherentes para desarrollo y demo.
 * Uso: npm run seed   (usa DATABASE_URL si existe, si no DB_PATH o ./data/oppi.db)
 * Es idempotente: vacía las tablas antes de cargar (orden inverso a las FK).
 */
const { openDb, migrate, run, queryOne, closeDb } = require('./db');
const { hashPassword } = require('./lib/auth');
const { getUploadsDir } = require('./lib/storage');

/** Escribe una foto de ejemplo válida (PNG) en la carpeta de uploads. */
function writeSeedPhoto(filename) {
  const zlib = require('node:zlib');
  const fs = require('node:fs');
  const path = require('node:path');
  const crcTable = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[n] = c;
  }
  const crc32 = (buf) => {
    let c = 0xFFFFFFFF;
    for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };
  const chunk = (type, data) => {
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(8 + td.length + 4);
    out.writeUInt32BE(data.length, 0);
    td.copy(out, 4);
    out.writeUInt32BE(crc32(td), 4 + td.length);
    return out;
  };
  const W = 96, H = 96;
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0;
    for (let x = 0; x < W; x++) {
      const o = y * (1 + W * 3) + 1 + x * 3;
      raw[o] = Math.floor(200 * x / W) + 30;
      raw[o + 1] = Math.floor(150 * y / H) + 40;
      raw[o + 2] = 120;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(path.join(getUploadsDir(), filename), png);
}

const DB_PATH = process.env.DB_PATH || './data/oppi.db';

/** Coordenadas aproximadas reales de Asunción por barrio (para el seed). */
const BARRIO_COORDS = {
  'Villa Morra': [-25.2907, -57.5725],
  'Carmelitas': [-25.2847, -57.5817],
  'Sajonia': [-25.3036, -57.6060],
  'Centro': [-25.2635, -57.5759],
  'Recoleta': [-25.2961, -57.5828],
  'Las Mercedes': [-25.2789, -57.5910],
  'Trinidad': [-25.2621, -57.5857],
  'Barrio Obrero': [-25.2894, -57.6149],
  'San Vicente': [-25.3062, -57.5893],
  'Jara': [-25.3100, -57.5700],
  'Hipódromo': [-25.3200, -57.5900],
  'Ytay': [-25.3150, -57.5550],
};
/** Si el barrio no está en la lista, se usa Villa Morra (zona céntrica del seed). */
function coordsOf(barrio) {
  return BARRIO_COORDS[barrio] || BARRIO_COORDS['Villa Morra'];
}

async function main() {
  const db = openDb(DB_PATH);
  await migrate(db);

  // Vaciar tablas (orden inverso a las FK; sin PRAGMA: funciona en sqlite y pg).
  // conversations.task_id → tasks NO tiene ON DELETE CASCADE: conversations
  // (y messages) tienen que vaciarse ANTES que tasks.
  for (const t of ['push_tokens', 'payments', 'notifications', 'referral_redemptions', 'referrals',
    'waitlist', 'team_members', 'business_documents', 'reviews', 'jobs', 'offers',
    'messages', 'conversations', 'favorites', 'bookings', 'tasks',
    'slots', 'services', 'businesses', 'professionals', 'users']) {
    await run(db, `DELETE FROM ${t}`, []);
  }

  const PW = hashPassword('oppi123');

  async function user(name, email, phone, role, referralCode) {
    const r = await run(db, `INSERT INTO users (name, email, phone, password_hash, role, referral_code)
                       VALUES (?,?,?,?,?,?)`, [name, email, phone, PW, role, referralCode]);
    await run(db, 'INSERT INTO referrals (code, owner_user_id, max_uses) VALUES (?,?,?)', [referralCode, r.id, 50]);
    return r.id;
  }
  async function pro(userId, bio, categories, rating, verified, barrio) {
    const [lat, lng] = coordsOf(barrio);
    const r = await run(db, `INSERT INTO professionals (user_id, bio, categories, rating, verified, barrio, lat, lng)
                       VALUES (?,?,?,?,?,?,?,?)`,
      [userId, bio, JSON.stringify(categories), rating, verified, barrio, lat, lng]);
    return r.id;
  }
  async function service({ professionalId, businessId, name, price, depositType = 'none', depositValue = 0 }) {
    const r = await run(db, `INSERT INTO services (professional_id, business_id, name, price_gs, deposit_type, deposit_value)
                       VALUES (?,?,?,?,?,?)`,
      [professionalId || null, businessId || null, name, price, depositType, depositValue]);
    return r.id;
  }

  // ---------- Usuarios: clientes ----------
  const ana = await user('Ana Duarte', 'ana@ejemplo.com.py', '0981 111 111', 'client', 'OPPI-ANA001');
  const jorge = await user('Jorge Samudio', 'jorge@ejemplo.com.py', '0981 222 222', 'client', 'OPPI-JOR002');
  const paola = await user('Paola Insfrán', 'paola@ejemplo.com.py', '0981 333 333', 'client', 'OPPI-PAO003');
  // Dueño del código de referido de prueba
  await user('Oppi Amigo', 'amigo@oppi.com.py', '0981 000 000', 'client', 'OPPI-AMIGO');

  // ---------- Usuarios: handymen ----------
  const charly = await user('Carlos "Charly" Duarte', 'charly@ejemplo.com.py', '0982 111 111', 'handyman', 'OPPI-CHA004');
  const miguel = await user('Miguel Ángel Rojas', 'miguel@ejemplo.com.py', '0982 222 222', 'handyman', 'OPPI-MIG005');
  const fatima = await user('Fátima Cabrera', 'fatima@ejemplo.com.py', '0982 333 333', 'handyman', 'OPPI-FAT006');

  // ---------- Profesionales (10) ----------
  const pros = [];
  async function addPro(name, email, phone, code, bio, categories, rating, verified, barrio, services) {
    const uid = await user(name, email, phone, 'pro', code);
    const pid = await pro(uid, bio, categories, rating, verified, barrio);
    const svcIds = [];
    for (const s of services) svcIds.push(await service({ professionalId: pid, ...s }));
    // Turnos de ejemplo: 2026-10-05 al 2026-10-07
    for (const d of ['2026-10-05', '2026-10-06', '2026-10-07']) {
      for (const t of ['09:00', '11:00', '15:00', '17:00']) {
        const exists = await queryOne(db,
          'SELECT id FROM slots WHERE professional_id = ? AND date = ? AND time = ?', [pid, d, t]);
        if (!exists) await run(db, 'INSERT INTO slots (professional_id, date, time) VALUES (?,?,?)', [pid, d, t]);
      }
    }
    pros.push({ uid, pid, name, svcIds });
    return pid;
  }

  await addPro('Camila Ferreira', 'camila@ejemplo.com.py', '0983 111 111', 'OPPI-CAM101',
    'Peluquera con 8 años de experiencia. Especialista en color y balayage. 💇‍♀️',
    ['peluquería', 'color'], 4.9, 1, 'Villa Morra',
    [{ name: 'Corte de pelo', price: 120000, depositType: 'percent', depositValue: 30 },
     { name: 'Color + nutrición', price: 350000, depositType: 'percent', depositValue: 50 }]);

  await addPro('Diego "El Colo" Martínez', 'colo@ejemplo.com.py', '0983 222 222', 'OPPI-COL102',
    'Barbero clásico. Corte a navaja, barba y buen ambiente. 💈',
    ['barbería'], 4.8, 1, 'Carmelitas',
    [{ name: 'Corte clásico', price: 80000, depositType: 'percent', depositValue: 20 },
     { name: 'Corte + barba', price: 130000, depositType: 'percent', depositValue: 20 }]);

  await addPro('Roberto Giménez', 'roberto@ejemplo.com.py', '0983 333 333', 'OPPI-ROB103',
    'Electricista matriculado. Instalaciones, tableros y urgencias. ⚡',
    ['electricidad'], 4.7, 1, 'Sajonia',
    [{ name: 'Revisión eléctrica a domicilio', price: 150000, depositType: 'fixed', depositValue: 50000 },
     { name: 'Instalación de ventilador de techo', price: 180000, depositType: 'fixed', depositValue: 60000 }]);

  await addPro('Juan Carlos Benítez', 'juancarlos@ejemplo.com.py', '0983 444 444', 'OPPI-JUA104',
    'Plomero de toda la vida. Destapes, canillas, termotanques. 🔧',
    ['plomería'], 4.9, 1, 'Las Mercedes',
    [{ name: 'Reparación de canilla', price: 90000, depositType: 'percent', depositValue: 30 },
     { name: 'Destape de cañería', price: 200000, depositType: 'percent', depositValue: 30 }]);

  await addPro('María Auxiliadora', 'mariaaux@ejemplo.com.py', '0983 555 555', 'OPPI-MAR105',
    'Limpieza profunda de hogares y oficinas. Dejo todo impecable. ✨',
    ['limpieza'], 5.0, 1, 'Villa Morra',
    [{ name: 'Limpieza profunda (3 ambientes)', price: 250000, depositType: 'percent', depositValue: 30 }]);

  await addPro('Sofía Amarilla', 'sofia@ejemplo.com.py', '0983 666 666', 'OPPI-SOF106',
    'Manicura y nail art. Semipermanente que dura de verdad. 💅',
    ['manicura', 'uñas'], 4.8, 0, 'Carmelitas',
    [{ name: 'Semipermanente', price: 110000, depositType: 'percent', depositValue: 50 }]);

  await addPro('Pedro Franco', 'pedro@ejemplo.com.py', '0983 777 777', 'OPPI-PED107',
    'Técnico en aire acondicionado. Instalación, carga de gas y mantenimiento. ❄️',
    ['climatización'], 4.6, 1, 'Sajonia',
    [{ name: 'Mantenimiento de split', price: 220000, depositType: 'fixed', depositValue: 80000 }]);

  await addPro('Lucía Bogado', 'lucia@ejemplo.com.py', '0983 888 888', 'OPPI-LUC108',
    'Maquilladora profesional para eventos, novias y quince años. 💄',
    ['maquillaje'], 4.9, 1, 'Las Mercedes',
    [{ name: 'Maquillaje social', price: 280000, depositType: 'percent', depositValue: 50 }]);

  await addPro('Andrés Vera', 'andres@ejemplo.com.py', '0983 999 999', 'OPPI-AND109',
    'Masoterapeuta. Descontracturante y relajante a domicilio. 💆',
    ['masajes', 'bienestar'], 4.7, 0, 'Villa Morra',
    [{ name: 'Masaje descontracturante (60 min)', price: 160000, depositType: 'percent', depositValue: 30 }]);

  await addPro('Hugo Cáceres', 'hugo@ejemplo.com.py', '0983 101 101', 'OPPI-HUG110',
    'Carpintero. Muebles a medida, reparaciones y armados. 🪚',
    ['carpintería'], 4.8, 1, 'Sajonia',
    [{ name: 'Armado de mueble', price: 140000, depositType: 'percent', depositValue: 30 }]);

  // ---------- Negocio: salón de belleza (Oppi Empresas) ----------
  const rosa = await user('Rosa Méndez', 'rosa@bellavista.com.py', '0984 111 111', 'business', 'OPPI-ROS201');
  const [bvLat, bvLng] = coordsOf('Villa Morra');
  const bizR = await run(db, `INSERT INTO businesses (user_id, name, ruc, categories, barrio, address, lat, lng, schedule)
    VALUES (?,?,?,?,?,?,?,?,?)`,
    [rosa, 'Salón Bella Vista', '80012345-6', JSON.stringify(['peluquería', 'estética']),
     'Villa Morra', 'Avda. Mariscal López 1234', bvLat, bvLng,
     JSON.stringify([{ day: 'lun-vie', open: '09:00', close: '19:00' }, { day: 'sáb', open: '08:00', close: '13:00' }])]);
  const bellaVistaId = bizR.id;
  for (const docType of ['ruc', 'habilitacion', 'identidad']) {
    await run(db, 'INSERT INTO business_documents (business_id, type, status) VALUES (?,?,?)',
      [bellaVistaId, docType, docType === 'ruc' ? 'approved' : 'pending']);
  }
  await run(db, `INSERT INTO team_members (business_id, name, role, services) VALUES (?,?,?,?)`,
    [bellaVistaId, 'Laura Giménez', 'Estilista senior', '["Peinado de fiesta","Alisado"]']);
  await run(db, `INSERT INTO team_members (business_id, name, role, services) VALUES (?,?,?,?)`,
    [bellaVistaId, 'Nadia Ferreira', 'Manicura', '["Semipermanente","Nail art"]']);
  await service({ businessId: bellaVistaId, name: 'Peinado de fiesta', price: 180000, depositType: 'percent', depositValue: 30 });
  await service({ businessId: bellaVistaId, name: 'Limpieza facial profunda', price: 220000, depositType: 'percent', depositValue: 50 });

  // ---------- Tareas handyman (6) con ofertas ----------
  async function task(clientId, title, description, category, barrio, min, max, urgent) {
    const [lat, lng] = coordsOf(barrio);
    const r = await run(db, `INSERT INTO tasks (client_id, title, description, category, barrio, lat, lng, price_min_gs, price_max_gs, urgent)
                       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [clientId, title, description, category, barrio, lat, lng, min, max, urgent ? 1 : 0]);
    return r.id;
  }
  async function offer(taskId, handymanId, amount, message, status = 'pending') {
    const r = await run(db, 'INSERT INTO offers (task_id, handyman_id, amount_gs, message, status) VALUES (?,?,?,?,?)',
      [taskId, handymanId, amount, message, status]);
    return r.id;
  }

  const t1 = await task(ana, 'Arreglar canilla que gotea', 'La canilla de la cocina gotea toda la noche. Es monocomando.', 'plomería', 'Sajonia', 80000, 120000, true);
  await offer(t1, charly, 90000, 'Voy mañana a la mañana, llevo repuestos. Queda en una hora.');
  await offer(t1, miguel, 75000, 'Puedo pasar hoy a la tarde si te sirve.');

  const t2 = await task(jorge, 'Pintar pieza de 3x4', 'Pieza vacía, paredes en buen estado. Pongo yo la pintura.', 'pintura', 'Villa Morra', 400000, 600000, false);
  await offer(t2, fatima, 450000, 'Dos manos de pintura, termino en dos días. Trabajo prolijo garantizado.');
  await offer(t2, charly, 500000, 'Incluyo lijado y enduido donde haga falta.');

  const t3 = await task(paola, 'Instalar ventilador de techo', 'Ya compré el ventilador, hay que instalarlo en el dormitorio.', 'electricidad', 'Carmelitas', 150000, 200000, true);
  await offer(t3, miguel, 160000, 'Soy electricista, lo dejo andando y probado en el día.');

  const t4 = await task(ana, 'Mudar un placard', 'Placard de 2 puertas, del dormitorio al quincho. Hay que desarmar y armar.', 'fletes', 'Las Mercedes', 200000, 300000, false);
  await offer(t4, charly, 220000, 'Voy con ayudante, lo desarmamos y armamos con cuidado.');
  await offer(t4, fatima, 250000, 'Tengo camioneta y herramientas. Coordinamos el día.');

  const t5 = await task(jorge, 'Cortar pasto y podar', 'Patio de 200m², pasto alto y dos arbustos para podar.', 'jardinería', 'Sajonia', 100000, 150000, false);
  await offer(t5, miguel, 120000, 'Llevo bordeadora y me llevo los restos verdes.');

  const t6 = await task(paola, 'Armar mueble de TV', 'Rack nuevo en caja, con manual. Necesito que quede firme en la pared.', 'carpintería', 'Villa Morra', 120000, 180000, false);
  const o61 = await offer(t6, charly, 130000, 'Lo armo y lo amuro a la pared con tarugos. Queda perfecto.');
  await offer(t6, miguel, 150000, 'Puedo ir el sábado a la mañana.');

  // Una oferta aceptada → job en curso (t6)
  await run(db, "UPDATE offers SET status = 'accepted' WHERE id = ?", [o61]);
  await run(db, "UPDATE offers SET status = 'rejected' WHERE task_id = ? AND id != ?", [t6, o61]);
  await run(db, "UPDATE tasks SET status = 'assigned' WHERE id = ?", [t6]);
  const seedJob = await run(db, `INSERT INTO jobs (task_id, offer_id, client_id, handyman_id, agreed_price_gs, status, paid_gs)
            VALUES (?,?,?,?,?,'in_progress',?)`, [t6, o61, paola, charly, 130000, 130000]);

  // ---------- Conversaciones y mensajes ----------
  async function conversation(participantIds, taskId = null) {
    const r = await run(db, 'INSERT INTO conversations (participants, task_id) VALUES (?,?)',
      [JSON.stringify(participantIds), taskId]);
    return r.id;
  }
  async function message(convId, senderId, text, photos = null, quote = null) {
    await run(db, 'INSERT INTO messages (conversation_id, sender_id, text, photos, quote) VALUES (?,?,?,?,?)',
      [convId, senderId, text, JSON.stringify(photos || []), quote ? JSON.stringify(quote) : null]);
  }
  // Ana ↔ Charly por la canilla (t1): Charly cotiza por chat, Ana acepta
  const c1 = await conversation([ana, charly], t1);
  await message(c1, ana, 'Hola Charly! La canilla gotea cada vez más fuerte 😅 ¿cuándo podrías pasar?');
  await message(c1, charly, 'Hola Ana! Paso mañana entre 9 y 11, ¿te viene bien? Te dejo la cotización acá 👇',
    null, { amount_gs: 90000, detail: 'Reparación de monocomando con repuestos incluidos', status: 'accepted' });
  await message(c1, ana, 'Dale, perfecto. Te espero mañana 🙌');

  // Jorge ↔ Camila: consulta con foto (la foto existe de verdad en /uploads)
  const camilaUid = pros[0].uid;
  const c2 = await conversation([jorge, camilaUid]);
  writeSeedPhoto('pelo-actual.png');
  await message(c2, jorge, 'Hola! Quiero hacerme color, te paso una foto de cómo lo tengo ahora',
    [{ filename: 'pelo-actual.png', url: '/uploads/pelo-actual.png' }]);
  await message(c2, camilaUid, 'Hola Jorge! Se puede lograr ese tono en una sesión. Te reservo el sábado 11:00 si querés 💇‍♀️');

  // ---------- Reserva de ejemplo + reseñas ----------
  const camilaSvc = await queryOne(db, 'SELECT * FROM services WHERE professional_id = ? LIMIT 1', [pros[0].pid]);
  const slot = await queryOne(db, "SELECT * FROM slots WHERE professional_id = ? AND status = 'free' LIMIT 1", [pros[0].pid]);
  const bR = await run(db, `INSERT INTO bookings (client_id, service_id, slot_id, status, paid_gs, paid, total_gs)
                      VALUES (?,?,?,?,?,?,?)`,
    [ana, camilaSvc.id, slot.id, 'completed', camilaSvc.price_gs, 1, camilaSvc.price_gs]);
  await run(db, "UPDATE slots SET status = 'booked' WHERE id = ?", [slot.id]);
  await run(db, `INSERT INTO reviews (booking_id, from_user, to_user, rating, text, reply_text, reply_at)
            VALUES (?,?,?,?,?,?,?)`,
    [bR.id, ana, camilaUid, 5, 'Camila es una genia, el color quedó increíble y fue puntualísima.',
     'Gracias Ana! Me alegra que te haya encantado. Te espero para el retoque 💛', '2026-09-30 12:00:00']);
  await run(db, `INSERT INTO reviews (job_id, from_user, to_user, rating, text) VALUES (?,?,?,?,?)`,
    [seedJob.id, paola, charly, 5, 'Charly armó el rack rapidísimo y lo dejó amurado perfecto. Recomendado.']);

  // Seed de admin: si ADMIN_EMAIL está seteada y coincide con un usuario del
  // seed, ese usuario nace admin. Nunca hay emails hardcodeados.
  const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (adminEmail) {
    const r = await run(db, 'UPDATE users SET is_admin = 1 WHERE LOWER(email) = ?', [adminEmail]);
    if (r.changes > 0) console.log(`[seed] ${adminEmail} marcado como admin.`);
    else console.log(`[seed] ADMIN_EMAIL=${adminEmail} no coincide con ningún usuario del seed.`);
  }

  await closeDb(db);
  console.log('Seed OK en', process.env.DATABASE_URL ? '(postgres)' : DB_PATH);
  console.log('Usuarios de prueba (password: oppi123):');
  console.log('  - ana@ejemplo.com.py (clienta)');
  console.log('  - charly@ejemplo.com.py (handyman)');
  console.log('  - camila@ejemplo.com.py (profesional)');
  console.log('  - rosa@bellavista.com.py (negocio)');
  console.log('  - amigo@oppi.com.py (dueño del código OPPI-AMIGO)');
}

main().catch((err) => {
  console.error('[seed] falló:', err.stack);
  process.exit(1);
});
